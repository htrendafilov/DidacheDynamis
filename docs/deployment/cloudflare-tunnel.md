# Cloudflare Tunnel & Origin Security

Production deployments run behind a **Cloudflare Tunnel**, providing DDoS mitigation, global CDN asset caching, and total origin isolation.

## Security Topology

```mermaid
flowchart TD
    PublicInternet([Public Internet Client]) -->|HTTPS| CFEdge[Cloudflare Edge / CDN]
    
    subgraph Origin Server (Private Network)
        cloudflared[cloudflared daemon\nSystemd Service]
        AppServer[FastAPI + Gunicorn\n127.0.0.1:8080]
        Firewall[Origin Firewall\nAll Inbound Web Ports BLOCKED]
    end

    CFEdge <===>|Encrypted QUIC Tunnel| cloudflared
    cloudflared -->|Local Loopback HTTP| AppServer
    PublicInternet -.-x|Direct Connection Blocked| Firewall
```

## Tunnel Key Benefits

1. **Closed Origin Bypass**: The origin server exposes no open inbound HTTP/HTTPS ports (`80`, `443`). Direct IP connection attempts fail immediately.
2. **Simplified TLS Management**: SSL/TLS terminates at the Cloudflare edge; no Let's Encrypt certificate renewal logic or cron renewal scripts are needed on the origin host.
3. **CDN Caching**: Hashed static assets (`/assets/*.js`, `/assets/*.css`) are cached at Cloudflare edge locations globally for maximum speed.
