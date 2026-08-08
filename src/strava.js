import polyline from '@mapbox/polyline';

const AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
const TOKEN_URL = 'https://www.strava.com/api/v3/oauth/token';
const ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities';
const DEAUTHORIZE_URL = 'https://www.strava.com/oauth/deauthorize';

const CONFIG_KEY = 'strava-config';
const TOKEN_KEY = 'strava-token';
const STATE_KEY = 'strava-oauth-state';

// Private activities are invisible to the plain `activity:read` scope.
const SCOPE = 'activity:read_all';
const PER_PAGE = 200;
const MAX_PAGES = 100;

// Strava sport types normalized onto the activity names used for track colors.
const SPORT_TYPES = {
    ebikeride: 'cycling',
    emountainbikeride: 'cycling',
    gravelride: 'cycling',
    handcycle: 'cycling',
    mountainbikeride: 'cycling',
    ride: 'cycling',
    velomobile: 'cycling',
    virtualride: 'cycling',
    run: 'running',
    trailrun: 'running',
    virtualrun: 'running',
    hike: 'hiking',
    snowshoe: 'hiking',
    walk: 'walking',
    wheelchair: 'walking',
    swim: 'swimming',
};


function readJson(storage, key) {
    try {
        return JSON.parse(storage.getItem(key));
    } catch {
        return null;
    }
}

function randomState() {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function redirectUri() {
    return `${window.location.origin}${window.location.pathname}`;
}

export function loadConfig() {
    const config = readJson(window.localStorage, CONFIG_KEY);

    if (!config || !config.clientId) {
        return null;
    }

    return config;
}

export function saveConfig({clientId, clientSecret, tokenExchangeUrl}) {
    if (!/^\d+$/.test(String(clientId).trim())) {
        throw new Error('Client ID must be the numeric ID of your Strava API application.');
    }

    const config = {clientId: String(clientId).trim()};

    if (tokenExchangeUrl) {
        let url;

        try {
            url = new URL(tokenExchangeUrl);
        } catch {
            throw new Error('Token exchange URL is not a valid URL.');
        }

        // The authorization code is a bearer credential, never send it in clear text.
        if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
            throw new Error('Token exchange URL must use https.');
        }

        config.tokenExchangeUrl = url.toString();
    } else if (clientSecret) {
        config.clientSecret = String(clientSecret).trim();
    } else {
        throw new Error('Provide either a client secret or a token exchange URL.');
    }

    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    return config;
}

export function isAuthorized() {
    const token = readJson(window.localStorage, TOKEN_KEY);
    return Boolean(token && token.refreshToken);
}

export function forgetConfig() {
    window.localStorage.removeItem(CONFIG_KEY);
}

async function requestToken(grant) {
    const config = loadConfig();

    if (!config) {
        throw new Error('No Strava application is configured.');
    }

    const payload = Object.assign({'client_id': config.clientId}, grant);

    if (!config.tokenExchangeUrl) {
        payload['client_secret'] = config.clientSecret;
    }

    const response = await fetch(config.tokenExchangeUrl || TOKEN_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        window.localStorage.removeItem(TOKEN_KEY);
        throw new Error(`Strava rejected the token request (HTTP ${response.status}).`);
    }

    const token = await response.json();

    if (!token.access_token || !token.refresh_token) {
        throw new Error('Strava returned an unexpected token response.');
    }

    window.localStorage.setItem(TOKEN_KEY, JSON.stringify({
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: token.expires_at,
    }));

    return token.access_token;
}

export function beginAuthorization() {
    const config = loadConfig();

    if (!config) {
        throw new Error('No Strava application is configured.');
    }

    const state = randomState();
    window.sessionStorage.setItem(STATE_KEY, state);

    const params = new URLSearchParams({
        'client_id': config.clientId,
        'redirect_uri': redirectUri(),
        'response_type': 'code',
        'approval_prompt': 'auto',
        scope: SCOPE,
        state,
    });

    window.location.assign(`${AUTHORIZE_URL}?${params}`);
}

export function hasPendingRedirect() {
    const params = new URLSearchParams(window.location.search);

    return (params.has('code') || params.has('error')) &&
        window.sessionStorage.getItem(STATE_KEY) !== null;
}

// Completes the OAuth redirect, returning true when a new token was obtained.
export async function completeRedirect() {
    if (!hasPendingRedirect()) {
        return false;
    }

    const params = new URLSearchParams(window.location.search);
    const expectedState = window.sessionStorage.getItem(STATE_KEY);

    window.sessionStorage.removeItem(STATE_KEY);
    window.history.replaceState({}, document.title, window.location.pathname);

    if (params.get('state') !== expectedState) {
        throw new Error('Strava response did not match the pending request, ignoring it.');
    }

    if (params.has('error')) {
        throw new Error(`Strava authorization was denied (${params.get('error')}).`);
    }

    if (!(params.get('scope') || '').split(',').includes(SCOPE)) {
        throw new Error(`Strava authorization needs the "${SCOPE}" permission.`);
    }

    await requestToken({'grant_type': 'authorization_code', code: params.get('code')});
    return true;
}

async function getAccessToken() {
    const token = readJson(window.localStorage, TOKEN_KEY);

    if (!token || !token.refreshToken) {
        return null;
    }

    // Refresh a minute early to avoid racing the expiry.
    if (token.accessToken && token.expiresAt * 1000 > Date.now() + 60000) {
        return token.accessToken;
    }

    return requestToken({'grant_type': 'refresh_token', 'refresh_token': token.refreshToken});
}

export async function disconnect() {
    const token = readJson(window.localStorage, TOKEN_KEY);
    window.localStorage.removeItem(TOKEN_KEY);

    if (!token || !token.accessToken) {
        return;
    }

    try {
        await fetch(DEAUTHORIZE_URL, {
            method: 'POST',
            headers: {Authorization: `Bearer ${token.accessToken}`},
        });
    } catch (err) {
        console.warn('Could not revoke the Strava token', err);
    }
}

function activityToTrack(activity) {
    const encoded = activity.map && activity.map.summary_polyline;

    if (!encoded) {
        return null;
    }

    const points = polyline.decode(encoded).map(([lat, lng]) => ({lat, lng}));

    if (points.length === 0) {
        return null;
    }

    const sportType = (activity.sport_type || activity.type || '').toLowerCase();

    return {
        timestamp: activity.start_date ? new Date(activity.start_date) : undefined,
        points,
        name: activity.name || 'Strava activity',
        activityType: SPORT_TYPES[sportType] || sportType || null,
        filename: `strava/${activity.id}`,
    };
}

// Walks the athlete's activity list, invoking onTrack for every activity that
// has a recorded route. onProgress receives running counts after each page.
export async function fetchActivities({onTrack, onProgress}) {
    const accessToken = await getAccessToken();

    if (!accessToken) {
        throw new Error('Not connected to Strava.');
    }

    let scanned = 0;
    let imported = 0;

    for (let page = 1; page <= MAX_PAGES; page++) {
        const params = new URLSearchParams({'per_page': PER_PAGE, page});
        const response = await fetch(`${ACTIVITIES_URL}?${params}`, {
            headers: {Authorization: `Bearer ${accessToken}`},
        });

        if (response.status === 429) {
            throw new Error('Strava rate limit reached, please try again in 15 minutes.');
        }

        if (!response.ok) {
            throw new Error(`Could not read activities from Strava (HTTP ${response.status}).`);
        }

        const activities = await response.json();

        for (const activity of activities) {
            scanned++;
            const track = activityToTrack(activity);

            if (track) {
                imported++;
                onTrack(track);
            }
        }

        onProgress({scanned, imported});

        if (activities.length < PER_PAGE) {
            break;
        }
    }

    return {scanned, imported};
}
