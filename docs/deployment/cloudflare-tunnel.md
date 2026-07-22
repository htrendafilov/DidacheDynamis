# Cloudflare Tunnel & Origin Security

The production Bible app runs behind a **Cloudflare Tunnel**, providing DDoS mitigation, global CDN
asset caching, and isolation of the Bible app's loopback origin.

## Security Topology

```mermaid
flowchart TD
    PublicInternet([Public Internet Client]) -->|HTTPS| CFEdge[Cloudflare Edge / CDN]
    
    subgraph Origin Server (Private Network)
        cloudflared[cloudflared daemon\nSystemd Service]
        AppServer[FastAPI + Gunicorn\n127.0.0.1:8080]
        Isolation[No public Bible vhost\nApp bound to loopback]
    end

    CFEdge <===>|Encrypted QUIC Tunnel| cloudflared
    cloudflared -->|Local Loopback HTTP| AppServer
    PublicInternet -.-x|No direct Bible route| Isolation
```

## Tunnel Key Benefits

1. **Closed Bible Origin Bypass**: Gunicorn listens only on `127.0.0.1:8080`, and the VM has no Caddy
   vhost for the Bible hostname. Other applications may still use the VM's public HTTP/HTTPS ports.
2. **Simplified TLS Management**: SSL/TLS terminates at the Cloudflare edge; no Let's Encrypt certificate renewal logic or cron renewal scripts are needed on the origin host.
3. **CDN Caching**: Hashed static assets (`/assets/*.js`, `/assets/*.css`) are cached at Cloudflare edge locations globally for maximum speed.
