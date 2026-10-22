# Running the print agent as a service

## Linux / Raspberry Pi (systemd)

```ini
# /etc/systemd/system/mdarai-print-agent.service
[Unit]
Description=MdarAi print agent
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/mdarai-wholesale-kiosk/services/print-agent
EnvironmentFile=/etc/mdarai/print-agent.env
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=5
User=mdarai

[Install]
WantedBy=multi-user.target
```

`/etc/mdarai/print-agent.env` holds `API_URL`, `PRINT_AGENT_TOKEN`, `PRINTER_MODE=network`, `PRINTER_HOST`, … (mode 600). Then: `systemctl enable --now mdarai-print-agent` and check with `journalctl -u mdarai-print-agent -f`.

## Windows

Install Node 22, build the agent, then register it with NSSM (https://nssm.cc): `nssm install MdarAiPrintAgent "C:\Program Files\nodejs\node.exe" dist\main.js`, set the working directory and environment variables in the NSSM dialog, and start the service.

## Checks after installing

1. The warehouse screen shows «الطابعة شغّالة» within 20 seconds.
2. Confirm a test order from the kiosk. The slip prints within a few seconds.
3. Switch the printer off and confirm another order. The order shows «فشلت الطباعة» after the retries. Switch it on and press «إعادة طباعة».
