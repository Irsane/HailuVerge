'use strict';

// Translate a HailuVerge server + settings + routing into a sing-box JSON config.
// Covers VLESS (TCP/WS/gRPC, TLS/Reality), Hysteria v1/v2, Trojan, Shadowsocks.
// Transports carry TCP/UDP, and VLESS XUDP multiplexing is enabled for UDP-over-stream.

function tlsBlock(r) {
  if (r.security !== 'tls' && r.security !== 'reality' && !r.sni && !r.insecure) {
    return undefined;
  }
  const tls = {
    enabled: true,
    server_name: r.sni || r.host || r.server,
    insecure: !!r.insecure
  };
  if (r.alpn) tls.alpn = r.alpn.split(',').map((s) => s.trim()).filter(Boolean);
  if (r.fp) tls.utls = { enabled: true, fingerprint: r.fp };
  if (r.security === 'reality' && r.pbk) {
    tls.reality = { enabled: true, public_key: r.pbk, short_id: r.sid || '' };
    if (!tls.utls) tls.utls = { enabled: true, fingerprint: r.fp || 'chrome' };
  }
  return tls;
}

function transportBlock(r) {
  switch (r.network) {
    case 'ws':
      return {
        type: 'ws',
        path: r.path || '/',
        headers: r.host ? { Host: r.host } : undefined
      };
    case 'grpc':
      return { type: 'grpc', service_name: r.serviceName || r.path || '' };
    case 'http':
    case 'h2':
      return {
        type: 'http',
        path: r.path || '/',
        host: r.host ? [r.host] : undefined
      };
    default:
      return undefined; // plain tcp
  }
}

function buildProxyOutbound(server) {
  const r = server.raw;
  const base = { type: server.protocol, tag: 'proxy', server: server.server, server_port: Number(server.port) };

  switch (server.protocol) {
    case 'vless': {
      const out = {
        ...base,
        uuid: r.uuid,
        flow: r.flow || '',
        packet_encoding: 'xudp' // XUDP: UDP relayed over the stream
      };
      const tls = tlsBlock(r);
      if (tls) out.tls = tls;
      const tr = transportBlock(r);
      if (tr) out.transport = tr;
      return out;
    }
    case 'trojan': {
      const out = { ...base, password: r.password };
      const tls = tlsBlock({ ...r, security: 'tls' });
      if (tls) out.tls = tls;
      const tr = transportBlock(r);
      if (tr) out.transport = tr;
      return out;
    }
    case 'hysteria2':
      return {
        ...base,
        password: r.password,
        obfs: r.obfs ? { type: r.obfs, password: r.obfsPassword } : undefined,
        tls: { enabled: true, server_name: r.sni || r.server, insecure: !!r.insecure,
               alpn: (r.alpn || 'h3').split(',').map((s) => s.trim()) }
      };
    case 'hysteria':
      return {
        ...base,
        auth_str: r.auth,
        up_mbps: r.upmbps || 50,
        down_mbps: r.downmbps || 200,
        obfs: r.obfs || undefined,
        tls: { enabled: true, server_name: r.sni || r.server, insecure: !!r.insecure,
               alpn: r.alpn ? r.alpn.split(',').map((s) => s.trim()) : undefined }
      };
    case 'shadowsocks':
      return { ...base, method: r.method, password: r.password };
    default:
      throw new Error(`Неподдерживаемый протокол: ${server.protocol}`);
  }
}

// TUN captures ALL traffic (TCP + UDP) so apps like Telegram/Discord work.
// It needs admin/root. When off we fall back to a local mixed proxy + system proxy.
function tunActive(settings, routing) {
  return !!settings.tunMode || (routing.appMode && routing.appMode !== 'off');
}

function buildInbounds(settings, routing) {
  const inbounds = [{
    type: 'mixed',
    tag: 'mixed-in',
    listen: settings.allowLan ? '0.0.0.0' : '127.0.0.1',
    listen_port: Number(settings.socksPort),
    udp_timeout: '5m'
  }];
  // Separate HTTP port for clients that need an explicit HTTP proxy endpoint.
  inbounds.push({
    type: 'http',
    tag: 'http-in',
    listen: settings.allowLan ? '0.0.0.0' : '127.0.0.1',
    listen_port: Number(settings.httpPort)
  });
  if (tunActive(settings, routing)) {
    inbounds.push({
      type: 'tun',
      tag: 'tun-in',
      interface_name: 'hailuverge0',
      // IPv4-only TUN. Capturing IPv6 on networks without working IPv6 makes
      // "direct" apps hang (they get an AAAA address and try to connect over a
      // dead v6 path) — proxied apps survive because v6 is reached via the
      // server. We also force ipv4_only DNS below, so no IPv6 is handed out.
      address: ['172.19.0.1/30'],
      // 9000 is fine when everything is tunneled, but for split tunnelling the
      // oversized segments can stall large direct transfers (MTU/MSS issues), so
      // use the standard 1500 in rule mode for reliability.
      mtu: routing.mode === 'global' ? 9000 : 1500,
      auto_route: true,
      // strict_route installs firewall filters that block traffic which tries to
      // bypass the tunnel. That breaks split tunneling: an app routed "direct"
      // (or any app not forced through the proxy) loses all connectivity, while
      // proxied apps keep working because the server IP is auto-excluded.
      // Only enforce it in global mode, where everything goes through the proxy.
      strict_route: routing.mode === 'global',
      stack: 'mixed',           // system stack for TCP, gVisor for UDP — reliable for VoIP/games
      endpoint_independent_nat: true
    });
  }
  return inbounds;
}

function buildRouteRules(settings, routing) {
  const rules = [];

  // Sniff protocol/SNI so domain rules and UDP (QUIC/DNS) are handled correctly.
  rules.push({ action: 'sniff' });
  // Resolve DNS queries inside sing-box.
  rules.push({ protocol: 'dns', action: 'hijack-dns' });

  if (routing.blockAds) {
    rules.push({ rule_set: ['geosite-category-ads-all'], action: 'reject' });
  }

  // Per-application routing (TUN only): force selected processes one way.
  if (routing.appMode && routing.appMode !== 'off' && Array.isArray(routing.appList) && routing.appList.length) {
    rules.push({
      process_name: routing.appList,
      outbound: routing.appMode === 'proxy' ? 'proxy' : 'direct'
    });
  }

  if (routing.mode !== 'global') {
    // Direct rules first so private/RU traffic bypasses the proxy.
    rules.push({ ip_is_private: true, outbound: 'direct' });
    if (routing.directDomains && routing.directDomains.length) {
      rules.push({ domain_suffix: routing.directDomains, outbound: 'direct' });
    }
    rules.push({ rule_set: ['geosite-ru', 'geoip-ru'], outbound: 'direct' });

    if (routing.proxyDomains && routing.proxyDomains.length) {
      rules.push({ domain_suffix: routing.proxyDomains, outbound: 'proxy' });
    }
  }

  return rules;
}

function buildRuleSets(routing) {
  const base = 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set';
  const ipBase = 'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set';
  const sets = [];
  // RU split lists are only needed in rule mode.
  if (routing.mode !== 'global') {
    sets.push(
      { tag: 'geosite-ru', type: 'remote', format: 'binary', url: `${base}/geosite-category-ru.srs`, download_detour: 'proxy' },
      { tag: 'geoip-ru', type: 'remote', format: 'binary', url: `${ipBase}/geoip-ru.srs`, download_detour: 'proxy' }
    );
  }
  // Ad-block list applies in any mode when enabled.
  if (routing.blockAds) {
    sets.push({ tag: 'geosite-category-ads-all', type: 'remote', format: 'binary',
      url: `${base}/geosite-category-ads-all.srs`, download_detour: 'proxy' });
  }
  return sets;
}

function buildConfig(server, settings, routing) {
  const finalOutbound = routing.mode === 'global'
    ? 'proxy'
    : (routing.finalOutbound === 'direct' ? 'direct' : 'proxy');

  return {
    log: { level: 'info', timestamp: true },
    // Resolve EVERYTHING through the proxy's DoH. It's fast, censorship-free and —
    // crucially — never depends on the (sometimes flaky) direct path, so name
    // lookups can't be what breaks direct apps. ipv4_only keeps any IPv6 address
    // out of apps' hands, which is what was stalling direct connections.
    dns: {
      servers: [
        { tag: 'dns-remote', address: 'https://1.1.1.1/dns-query', detour: 'proxy' }
      ],
      final: 'dns-remote',
      strategy: 'ipv4_only',
      independent_cache: true
    },
    inbounds: buildInbounds(settings, routing),
    outbounds: [
      buildProxyOutbound(server),
      { type: 'direct', tag: 'direct' }
    ],
    route: {
      rules: buildRouteRules(settings, routing),
      rule_set: buildRuleSets(routing),
      final: finalOutbound,
      auto_detect_interface: true
    }
  };
}

module.exports = { buildConfig, buildProxyOutbound };
