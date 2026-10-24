# Ad Hider for X

A small Chrome extension that hides promoted posts ("Ad" / "Promoted" / «Реклама») on x.com and can optionally block the accounts behind them.

## Features

- **Hide ads.** Promoted posts, promoted trends and promoted "Who to follow" accounts are removed from the page. The ad label is recognized in English, Russian, Japanese, German, Spanish, French, Italian, Turkish, Polish and Portuguese.
- **Block advertisers (optional, off by default).** Blocks each advertiser from your own account, so their ads also disappear in the X mobile apps and on your other devices.
- **Close Premium popups.** Windows like "Get Plus" that X shows after you post are closed automatically.
- **Tidy the right sidebar.** Separate switches hide "Subscribe to Premium" (on by default), "What's happening", "Who to follow", any other blocks such as sports scores (on by default) and the search box.
- **Advertiser list.** Shows every advertiser that has appeared in your feed and how often. You can block them one at a time or all at once.
- **Debug mode.** Outlines detected ads in red instead of hiding them, so you can check what the extension catches.

The popup is available in English, Russian and Japanese and follows your Chrome UI language. Any other language falls back to English. Translations live in `_locales/<lang>/messages.json`, so adding a language is just adding one file.

## Install

The extension is not in the Chrome Web Store, so you load it manually:

1. Download this repository (Code → Download ZIP) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.
4. Reload x.com.

## How it works

- `content.js` watches the timeline and looks for the ad label in each post's header. The post text, author name and link previews are ignored, so a regular post that contains the word "Ad" is not hidden.
- Blocking uses the same internal endpoint that x.com calls when you click "Block". Requests go out one at a time, 5–8 seconds apart, and pause for 15 minutes if X reports a rate limit. Blocking only runs while an x.com tab is open.
- All data (settings, counters, the advertiser list) stays in `chrome.storage.local`. Nothing is sent anywhere except to x.com itself.

## Caveats

- **Auto-blocking is automated activity on your account.** It is deliberately slow, but X could still treat it as automation. Use it at your own risk.
- **X changes its site often.** If ads stop being hidden or blocks start failing (the popup shows the error, for example `HTTP 403`), please open an issue.
- Blocking advertisers reduces ads over time but cannot remove them completely: new advertisers keep appearing.

## Disclaimer

This is an independent project. It is not affiliated with, endorsed by or sponsored by X Corp. "X" and "Twitter" are trademarks of X Corp. and are used here only to describe which site the extension works with.

## License

[MIT](LICENSE)
