# Bayline Sports architecture diagram

- **bayline-architecture.svg**: scalable vector version, recommended for a website. Export size: 1600 × 1120.
- **bayline-architecture.png**: high-resolution raster version, 3200 × 2240 pixels.

The diagram describes the deployed MVP architecture, including Warriors broadcast syncing verified on October 26, 2026. It distinguishes browser cache refresh from provider polling (including a 15-minute official NBA network check), keeps the worker separate from web, and shows private PostgreSQL storage, off-server backups, independent monitoring and the operator-triggered release path.

Example HTML after uploading the SVG to your website's images directory:

```html
<figure>
  <img
    src="/images/bayline-architecture.svg"
    alt="Bayline Sports architecture: browser requests flow through Caddy to Next.js; an independent worker ingests sports and YouTube data into private PostgreSQL, supported by off-server backups and AWS monitoring."
    width="1600"
    height="1120"
    style="display:block;width:100%;height:auto"
    loading="lazy"
  />
  <figcaption>Bayline Sports production architecture, October 2026.</figcaption>
</figure>
```

The files contain no scripts, embedded credentials, account identifiers or external font/image dependencies. They are downloadable assets; your existing website has not been changed.
