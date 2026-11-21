# YouTube embeds

Ganetios and OmniWrite use `munetios-youtube-player`. It contains a nocookie iframe inside an open shadow root and uses YouTube's built-in playback controls, settings and captions. There are no custom YouTube control or caption overlays. The iframe loads only after the viewer accepts the ad/privacy warning, which remains visible below the video. Nocookie mode does not prevent advertising or the browser's direct connections required for playback. Normal uploaded video/audio players keep their custom controls.

Express serves `/api/youtube/iframe-api`, `/api/youtube/widget-api`, `/api/youtube/video/:id`, and `/api/youtube/captions/:id`. Application-level YouTube API and player-script requests use these same-origin routes. The optional player SDK only preserves playback state when using the surrounding app's miniplayer. If that SDK fails, the native iframe still loads and works independently. The server contacts only fixed upstream YouTube/Google endpoints; visitors cannot supply arbitrary proxy URLs. No visitor cookies or authorization headers are forwarded upstream. Caption authorization, when configured, is server-owned.

Deploy the Express routes with the site on the Munetios server for application API calls. The player intentionally has no direct-browser API fallback. YouTube's embedded player itself handles its own streaming and native captions.

Previously saved custom caption attributes remain in documents, but the YouTube component no longer renders or edits them. Uploaded video/audio players retain their existing caption features.

The existing server caption endpoint remains available for authorized integrations through `YOUTUBE_CAPTIONS_ACCESS_TOKEN`; the native YouTube UI does not use it. It serves only public, embeddable videos the token owner can edit, and does not expose private or unlisted videos. Token refresh is managed by the operator; the app never exposes this token to the browser.

See [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference), [player parameters](https://developers.google.com/youtube/player_parameters), and [caption download authorization](https://developers.google.com/youtube/v3/docs/captions/download).
