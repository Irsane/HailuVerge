# Папка ядра (sing-box)

HailuVerge использует [sing-box](https://github.com/SagerNet/sing-box) как движок,
который поддерживает протоколы **VLESS, Hysteria, Hysteria2, Trojan, Shadowsocks**,
транспорт **TCP/UDP** и мультиплексирование **XUDP**.

Положите сюда исполняемый файл ядра:

- Windows → `sing-box.exe`
- macOS / Linux → `sing-box`

## Автоматическая загрузка

```bash
npm run core
```

Скрипт скачает подходящий бинарник из официальных релизов sing-box
для вашей платформы и поместит его в эту папку.

Либо скачайте вручную со страницы релизов и распакуйте бинарник сюда:
https://github.com/SagerNet/sing-box/releases
