# dérive

![los angeles.](http://i.imgur.com/Asf744D.jpg)

Generate a heatmap from GPS tracks.

Drag and drop one or more GPX/TCX/FIT/IGC/SKIZ files or JPEG images into the browser
window. No data is ever uploaded, everything is done client side.

Loosely inspired by [The Passage Ride](http://thepassageride.com), which you
should join if you ever find yourself in Los Angeles on any given Wednesday
night.

http://library.nothingness.org/articles/SI/en/display/314

## Strava

### Import from the API

Click the <kbd>⚡</kbd> button to pull your activities straight from Strava
instead of importing a bulk export. dérive uses **your own** Strava API
application, so the requests go from your browser to Strava and nowhere else.

1. Create an application at [strava.com/settings/api](https://www.strava.com/settings/api).
2. Set its *Authorization Callback Domain* to the domain you're running dérive on.
3. Paste the Client ID and Client Secret into the dialog and connect.

Only the `activity:read_all` scope is requested, and only the summary polyline
of each activity is used, so a full history costs one request per 200
activities.

> **Note on the client secret:** Strava's OAuth does not support PKCE, so the
> token exchange requires the client secret. It is kept in your browser's
> `localStorage` and is only ever sent to Strava. If you'd rather not keep a
> secret in the browser, host a small endpoint that performs the token exchange
> and enter its URL in the *Token proxy URL* field instead — dérive will POST
> the authorization code there and never see the secret.

### Bulk export

Alternatively, go to your
[account download page](https://www.strava.com/athlete/delete_your_account)
and click "Request your archive". You'll get an email containing a ZIP
file of all the GPS tracks you've logged so far. This can take several hours.

## Developing

```bash
# Install dependencies
$ npm install

# Run server with hot reload for local development
$ npm run serve

# Lint code
$ npm run lint

# Build bundle for deployment
$ npm run build
```
