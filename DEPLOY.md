# Share Chess Coach

The app is a static website. For someone outside your Mac, publish these files:

- `index.html`
- `styles.css`
- `app.js`
- `manifest.webmanifest`
- `sw.js`
- `icon.svg`

## Fastest Public Option: Netlify Drop

1. Open https://app.netlify.com/drop in a browser.
2. Drag this whole `Chess` folder onto the page.
3. Netlify gives you a public URL.
4. Open that URL on your phone and send it to the other person.

No build command is needed.

## GitHub Pages

1. Create a new GitHub repository.
2. Upload the files listed above.
3. In the repo settings, enable Pages from the `main` branch and root folder.
4. Share the GitHub Pages URL.

## Same Wi-Fi Option

Run:

```sh
python3 serve.py
```

Then open the `Phone / same Wi-Fi` URL it prints.

If the phone says the network is closed, hangs, or cannot connect, the app is still fine. The Mac or Wi-Fi network is blocking inbound local connections. Common fixes:

- Make sure the phone and Mac are on the same Wi-Fi, not guest Wi-Fi.
- Turn off VPN temporarily.
- Allow incoming connections for Python in macOS firewall settings.
- Try a public deploy instead of local Wi-Fi sharing.
