import picoModal from 'picomodal';
import JSZip from 'jszip';
import extractTracks from './track';
import Image from './image';
import * as strava from './strava';

const AVAILABLE_THEMES = [
    'CartoDB.DarkMatter',
    'CartoDB.DarkMatterNoLabels',
    'CartoDB.Positron',
    'CartoDB.PositronNoLabels',
    'CartoDB.Voyager',
    'CartoDB.VoyagerNoLabels',
    'Esri.WorldImagery',
    'Esri.WorldGrayCanvas',
    'Esri.WorldTopoMap',
    'OpenStreetMap.Mapnik',
    'OpenStreetMap.HOT',
    'OpenTopoMap',
    'CyclOSM',
    'USGS.USImagery',
    'No map',
];

const TRACK_FILE_PATTERN = /\.(gpx|tcx|fit|igc|skiz)(\.gz)?$/i;
const IMAGE_FILE_PATTERN = /\.jpe?g$/i;
const ZIP_FILE_PATTERN = /\.zip$/i;
const STRAVA_ZIP_SKIPPED_FOLDERS = ['media', 'routes'];

const MODAL_CONTENT = {
    help: `
<h1>dérive</h1>
<h4>Drag and drop one or more GPX/TCX/FIT/IGC/SKIZ files, JPEG images, or a Strava export ZIP/folder here.</h4>
<p>If you use Strava, you can pull your activities straight from the API with
the <i class="fa fa-bolt"></i> button, or go to your
<a href="https://www.strava.com/athlete/delete_your_account">account download
page</a> and click "Request your archive". You'll get an email containing a ZIP
file of all the GPS tracks you've logged so far. This can take several hours.
</p>

<p>All processing happens in your browser. Your files will not be uploaded or
stored anywhere.</p>

<blockquote>
In a dérive one or more persons during a certain period drop their
relations, their work and leisure activities, and all their other
usual motives for movement and action, and let themselves be drawn by
the attractions of the terrain and the encounters they find there.<cite><a
href="http://library.nothingness.org/articles/SI/en/display/314">[1]</a></cite>
</blockquote>

<p>Code is available <a href="https://github.com/erik/derive">on GitHub</a>.</p>
`,

    exportImage: `
<h3>Export Image</h3>

<form id="export-settings">
    <div class="form-row">
        <label>Format:</label>
        <select name="format">
            <option selected value="png">PNG</option>
            <option value="svg">SVG (no background map)</option>
        </select>
    </div>

    <div class="form-row">
        <label></label>
        <input id="render-export" type="button" value="Render">
    </div>
</form>

<p id="export-output"></p>
`
};


function escapeHtml(text) {
    const replacements = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        '\'': '&#39;',
    };

    return String(text).replace(/[&<>"']/g, c => replacements[c]);
}

// Replace the body of a modal without removing its close button. PicoModal
// does not allow for native content overwriting.
function overrideModalContent(modal, body) {
    Array.from(modal.modalElem().childNodes).forEach(child => {
        if (child !== modal.closeElem()) {
            modal.modalElem().removeChild(child);
        }
    });

    modal.modalElem().insertAdjacentHTML('afterbegin', body);
}

function formatFailureReason(error) {
    if (typeof error === 'string') {
        return error;
    }

    if (error && typeof error.message === 'string' && error.message.length > 0) {
        return error.message;
    }

    return 'Unknown error';
}

function formatNumber(value, maxFractionDigits = 2) {
    return Number(value || 0).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: maxFractionDigits,
    });
}

function formatDate(value) {
    if (!(value instanceof Date) || isNaN(value)) {
        return 'n/a';
    }

    return value.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

// Adapted from: http://www.html5rocks.com/en/tutorials/file/dndfiles/
function isImportableFile(fileName) {
    return TRACK_FILE_PATTERN.test(fileName) || IMAGE_FILE_PATTERN.test(fileName);
}

function isImportableTrackFile(fileName) {
    return TRACK_FILE_PATTERN.test(fileName);
}

function isZipArchive(fileName) {
    return ZIP_FILE_PATTERN.test(fileName);
}

function inferMimeType(fileName) {
    return IMAGE_FILE_PATTERN.test(fileName)
        ? 'image/jpeg'
        : 'application/octet-stream';
}

async function extractZipFiles(zipFile) {
    const zip = await JSZip.loadAsync(zipFile);
    const isSkippedPath = (entryName) => {
        const segments = entryName
            .toLowerCase()
            .split('/')
            .filter(Boolean);

        return segments.some(segment => STRAVA_ZIP_SKIPPED_FOLDERS.includes(segment));
    };

    const entries = Object.values(zip.files).filter(entry => {
        return !entry.dir &&
            !isSkippedPath(entry.name) &&
            isImportableTrackFile(entry.name);
    });

    const extractedEntries = await Promise.all(entries.map(async entry => {
        const contents = await entry.async('blob');
        const fileName = entry.name.split('/').pop();

        return new File([contents], fileName, {
            type: inferMimeType(fileName),
            lastModified: zipFile.lastModified || Date.now(),
        });
    }));

    return extractedEntries;
}

async function normalizeDroppedFile(file) {
    if (isImportableFile(file.name)) {
        return [file];
    }

    if (isZipArchive(file.name)) {
        return extractZipFiles(file);
    }

    return [];
}

function readDroppedEntryFile(entry) {
    return new Promise((resolve, reject) => {
        entry.file(resolve, reject);
    });
}

function readDroppedDirectoryEntries(reader) {
    return new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
    });
}

async function collectDroppedEntryFiles(entry) {
    if (entry.isFile) {
        const file = await readDroppedEntryFile(entry);
        return normalizeDroppedFile(file);
    }

    if (!entry.isDirectory) {
        return [];
    }

    const entries = [];
    const reader = entry.createReader();

    // FileSystemDirectoryReader returns entries in batches.
    while (true) {
        const batch = await readDroppedDirectoryEntries(reader);
        if (batch.length === 0) {
            break;
        }
        entries.push(...batch);
    }

    const nestedFiles = await Promise.all(entries.map(collectDroppedEntryFiles));
    return nestedFiles.flat();
}

async function getDroppedFiles(evt) {
    const items = Array.from(evt.dataTransfer.items || []);
    const canReadEntries = items.some(item => typeof item.webkitGetAsEntry === 'function');

    if (canReadEntries) {
        const entries = items
            .map(item => item.webkitGetAsEntry())
            .filter(Boolean);

        const droppedFiles = await Promise.all(entries.map(collectDroppedEntryFiles));
        return droppedFiles.flat();
    }

    return Array
        .from(evt.dataTransfer.files || [])
        .map(normalizeDroppedFile)
        .reduce(async (allFilesPromise, filesPromise) => {
            const [allFiles, files] = await Promise.all([allFilesPromise, filesPromise]);
            return allFiles.concat(files);
        }, Promise.resolve([]));
}

async function handleFileSelect(map, evt) {
    evt.stopPropagation();
    evt.preventDefault();

    let files = await getDroppedFiles(evt);

    if (files.length === 0) {
        return;
    }

    let modal = buildUploadModal(files.length);

    modal.show();

    const handleImage = async file => {
        const image = new Image(file);
        const hasGeolocationData = await image.hasGeolocationData();
        if (!hasGeolocationData) { throw 'No geolocation data'; }
        await map.addImage(image);
        modal.addSuccess();
    };

    const handleTrackFile = async (file) => {
        for (const track of await extractTracks(file)) {
            track.filename = file.name;

            if (map.addTrack(track)) {
                modal.addSuccess();
            } else {
                modal.addSkippedDuplicate();
            }
        }
    };

    const handleFile = async file => {
        try {
            if (IMAGE_FILE_PATTERN.test(file.name)) {
                return await handleImage(file);
            }
            return await handleTrackFile(file);
        } catch (err) {
            console.error(err);
            modal.addFailure({name: file.name, error: err});
        }
    };

    Promise.all(files.map(handleFile)).then(() => {
        map.center();
        modal.finished();
    });
}


function handleDragOver(evt) {
    evt.dataTransfer.dropEffect = 'copy';
    evt.stopPropagation();
    evt.preventDefault();
}


function buildUploadModal(numFiles) {
    let numLoaded = 0;
    let numSkippedDuplicates = 0;
    let failures = [];
    let getModalContent = () => {
        let failureString = failures.length
            ? `, <span class='failures'>${failures.length} failed</span>`
            : '';

        return `
        <h1>Reading files...</h1>
        <p>${numLoaded} loaded${failureString} of <b>${numFiles}</b></p>
        <p>${numSkippedDuplicates} duplicate${numSkippedDuplicates === 1 ? '' : 's'} skipped</p>`;
    };

    let modal = picoModal({
        content: getModalContent(),
        escCloses: false,
        overlayClose: false,
        overlayStyles: styles => {
            styles.opacity = 0.1;
        },
    });

    modal.afterCreate(() => {
        // Do not allow the modal to be closed before loading is complete.
        // PicoModal does not allow for native toggling
        modal.closeElem().style.display = 'none';
    });

    modal.afterClose(() => modal.destroy());

    // Override the content of the modal, without removing the close button.
    modal.setContent = body => overrideModalContent(modal, body);

    modal.addFailure = failure => {
        failures.push({
            name: failure.name,
            reason: formatFailureReason(failure.error),
        });
        modal.setContent(getModalContent());
    };

    modal.addSuccess = () => {
        numLoaded++;
        modal.setContent(getModalContent());
    };

    modal.addSkippedDuplicate = () => {
        numSkippedDuplicates++;
        modal.setContent(getModalContent());
    };

    // Show any errors, or close modal if no errors occurred
    modal.finished = () => {
        let failedItems = failures.map(failure => {
            return `<li><b>${escapeHtml(failure.name)}</b>: ${escapeHtml(failure.reason)}</li>`;
        });
        const failureDetails = failures.length > 0
            ? `<ul class="failures">${failedItems.join('')}</ul>`
            : '<p>No failures.</p>';

        modal.setContent(`
            <h1>Import complete</h1>
            <p>
                Processed <b>${numFiles}</b> file${numFiles === 1 ? '' : 's'}.
            </p>
            <p>
                Loaded: <b>${numLoaded}</b><br>
                Duplicates skipped: <b>${numSkippedDuplicates}</b><br>
                Failures: <b>${failures.length}</b>
            </p>
            ${failureDetails}`);
        // enable all the methods of closing the window
        modal.closeElem().style.display = '';
        modal.options({
            escCloses: true,
            overlayClose: true,
        });
    };

    return modal;
}


export function buildSettingsModal(tracks, opts, updateCallback) {
    let overrideExisting = opts.lineOptions.overrideExisting ? 'checked' : '';

    if (tracks.length > 0) {
        let allSameColor = tracks.every(({line}) => {
            return line.options.color === tracks[0].line.options.color;
        });

        if (!allSameColor) {
            overrideExisting = false;
        } else {
            opts.lineOptions.color = tracks[0].line.options.color;
        }
    }

    let detect = opts.lineOptions.detectColors ? 'checked' : '';
    let themes = AVAILABLE_THEMES.map(t => {
        let selected = (t === opts.theme) ? 'selected' : '';
        return `<option ${selected} value="${t}">${t}</option>`;
    });

    let modalContent = `
<h3>Options</h3>

<form id="settings">
    <span class="form-row">
        <label>Theme</label>
        <select name="theme">
            ${themes}
        </select>
    </span>

    <fieldset class="form-group">
        <legend>GPS Track Options</legend>

        <div class="row">
            <label>Color</label>
            <input name="color" type="color" value=${opts.lineOptions.color}>
        </div>

        <div class="row">
            <label>Opacity</label>
            <input name="opacity" type="range" min=0 max=1 step=0.01
                value=${opts.lineOptions.opacity}>
        </div>

        <div class="row">
            <label>Width</label>
            <input name="weight" type="number" min=1 max=100
                value=${opts.lineOptions.weight}>
        </div>

    </fieldset>

    <fieldset class="form-group">
        <legend>Image Marker Options</legend>

        <div class="row">
            <label>Color</label>
            <input name="markerColor" type="color" value=${opts.markerOptions.color}>
        </div>

        <div class="row">
            <label>Opacity</label>
            <input name="markerOpacity" type="range" min=0 max=1 step=0.01
                value=${opts.markerOptions.opacity}>
        </div>

        <div class="row">
            <label>Width</label>
            <input name="markerWeight" type="number" min=1 max=100
                value=${opts.markerOptions.weight}>
        </div>

        <div class="row">
            <label>Radius</label>
            <input name="markerRadius" type="number" min=1 max=100
                value=${opts.markerOptions.radius}>
        </div>

    </fieldset>

    <span class="form-row">
        <label>Override existing tracks</label>
        <input name="overrideExisting" type="checkbox" ${overrideExisting}>
    </span>

    <span class="form-row">
        <label>Detect color from Strava bulk export</label>
        <input name="detectColors" type="checkbox" ${detect}>
    </span>
</form>`;

    let modal = picoModal({
        content: modalContent,
        closeButton: true,
        escCloses: true,
        overlayClose: true,
        overlayStyles: (styles) => {
            styles.opacity = 0.1;
        },
    });

    let applyOptions = () => {
        let elements = document.getElementById('settings').elements;
        let options = Object.assign({}, opts);

        for (let opt of ['theme']) {
            options[opt] = elements[opt].value;
        }

        for (let opt of ['color', 'weight', 'opacity']) {
            options.lineOptions[opt] = elements[opt].value;
        }

        for (let opt of ['markerColor', 'markerWeight', 'markerOpacity', 'markerRadius']) {
            let optionName = opt.replace('marker', '').toLowerCase();
            options.markerOptions[optionName] = elements[opt].value;
        }

        for (let opt of ['overrideExisting', 'detectColors']) {
            options.lineOptions[opt] = elements[opt].checked;
        }

        updateCallback(options);
    };

    modal.afterClose((modal) => {
        applyOptions();
        modal.destroy();
    });

    modal.afterCreate(() => {
        let elements = document.getElementById('settings').elements;
        for (let opt of ['theme', 'color', 'weight', 'opacity', 'markerColor',
            'markerWeight', 'markerOpacity', 'markerRadius']) {
            elements[opt].addEventListener('change', applyOptions);
        }
    });


    return modal;
}

export function buildFilterModal(tracks, filters, finishCallback) {
    let maxDate = new Date().toISOString().split('T')[0];

    const years = [...new Set(
        tracks
            .filter(t => t.timestamp instanceof Date && !isNaN(t.timestamp))
            .map(t => t.timestamp.getFullYear())
    )].sort((a, b) => b - a);

    const yearButtons = years.map(y =>
        `<button type="button" class="year-preset" data-year="${y}">${y}</button>`
    ).join('');

    let modalContent = `
<h3>Filter Displayed Tracks</h3>

<form id="settings">
    ${years.length > 0 ? `
    <span class="form-row">
        <label>Year:</label>
        <span class="year-presets">${yearButtons}
            <button type="button" class="year-preset year-preset--clear" data-year="">All</button>
        </span>
    </span>` : ''}

    <span class="form-row">
        <label for="minDate">Start date:</label>
        <input type="date" id="minDate" name="minDate"
            value="${filters.minDate || ''}"
            min="1990-01-01"
            max="${maxDate}">
    </span>

    <span class="form-row">
        <label for="maxDate">End date:</label>
        <input type="date" id="maxDate" name="maxDate"
            value="${filters.maxDate || ''}"
            min="1990-01-01"
            max="${maxDate}">
    </span>
</form>`;

    let modal = picoModal({
        content: modalContent,
        closeButton: true,
        escCloses: true,
        overlayClose: true,
        overlayStyles: (styles) => {
            styles.opacity = 0.1;
        },
    });

    modal.afterCreate(() => {
        document.querySelectorAll('.year-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                const year = btn.dataset.year;
                const minInput = document.getElementById('minDate');
                const maxInput = document.getElementById('maxDate');
                if (year) {
                    minInput.value = `${year}-01-01`;
                    maxInput.value = `${year}-12-31`;
                } else {
                    minInput.value = '';
                    maxInput.value = '';
                }
            });
        });
    });

    modal.afterClose((modal) => {
        let elements = document.getElementById('settings').elements;
        let updated = Object.assign({}, filters);

        for (let key of ['minDate', 'maxDate']) {
            updated[key] = elements[key].value;
        }

        finishCallback(updated);
        modal.destroy();
    });

    return modal;
}

export function buildSummaryModal(summary) {
    const activityBreakdown = Object.entries(summary.activities || {})
        .sort((a, b) => b[1] - a[1])
        .map(([activity, count]) => `<li><b>${escapeHtml(activity)}</b>: ${count}</li>`)
        .join('');

    const activitiesContent = activityBreakdown.length > 0
        ? `<ul class="summary-list">${activityBreakdown}</ul>`
        : '<p>No activity type data available.</p>';

    const modalContent = `
<h3>Summary</h3>

<div class="summary-grid">
    <p><b>Total distance:</b> ${formatNumber(summary.totalDistanceKm)} km</p>
    <p><b>Visible distance:</b> ${formatNumber(summary.visibleDistanceKm)} km</p>
    <p><b>Tracks:</b> ${summary.visibleTracks} visible / ${summary.totalTracks} total</p>
    <p><b>Total points:</b> ${formatNumber(summary.totalPoints, 0)}</p>
    <p><b>Avg distance/track:</b> ${formatNumber(summary.averageDistanceKm)} km</p>
    <p><b>Longest track:</b> ${formatNumber(summary.longestTrackKm)} km</p>
    <p><b>Date range:</b> ${formatDate(summary.startDate)} to ${formatDate(summary.endDate)}</p>
</div>

<h4>Activity mix</h4>
${activitiesContent}`;

    let modal = picoModal({
        content: modalContent,
        closeButton: true,
        escCloses: true,
        overlayClose: true,
        overlayStyles: (styles) => {
            styles.opacity = 0.1;
        },
    });

    modal.afterClose(modal => modal.destroy());

    return modal;
}

export function showModal(type) {
    let modal = picoModal({
        content: MODAL_CONTENT[type],
        overlayStyles: (styles) => {
            styles.opacity = 0.01;
        },
    });

    modal.show();
    return modal;
}


function buildStravaProgressModal() {
    let modal = picoModal({
        content: '<h3>Importing from Strava</h3><p>Contacting Strava&hellip;</p>',
        escCloses: false,
        overlayClose: false,
        overlayStyles: styles => {
            styles.opacity = 0.1;
        },
    });

    modal.afterCreate(() => {
        modal.closeElem().style.display = 'none';
    });

    modal.afterClose(() => modal.destroy());

    modal.setContent = body => overrideModalContent(modal, body);

    modal.allowClose = () => {
        modal.closeElem().style.display = '';
        modal.options({escCloses: true, overlayClose: true});
    };

    return modal;
}


export async function importStravaActivities(map) {
    let modal = buildStravaProgressModal();
    modal.show();

    try {
        const {scanned, imported, skipped} = await strava.fetchActivities({
            onTrack: track => map.addTrack(track),
            onProgress: progress => modal.setContent(`
                <h3>Importing from Strava</h3>
                <p>${progress.imported} route${progress.imported === 1 ? '' : 's'}
                   imported from ${progress.scanned} activities,
                   ${progress.skipped} duplicate${progress.skipped === 1 ? '' : 's'} skipped&hellip;</p>`),
        });

        map.center();

        if (imported > 0) {
            return modal.close();
        }

        modal.setContent(`
            <h3>Nothing to import</h3>
            <p>None of your ${scanned} Strava activities added a new route.
               ${skipped} duplicate${skipped === 1 ? '' : 's'} were skipped.</p>`);
    } catch (err) {
        console.error(err);
        modal.setContent(`
            <h3>Strava import failed</h3>
            <p class="failures">${escapeHtml(err.message)}</p>`);
    }

    modal.allowClose();
}


export function buildStravaModal(map) {
    const config = strava.loadConfig() || {};
    const connected = strava.isAuthorized();

    const actions = connected
        ? `<button id="strava-import" type="button">Import activities</button>
           <button id="strava-disconnect" type="button">Disconnect</button>`
        : '<button id="strava-connect" type="button">Connect to Strava</button>';

    const modalContent = `
<h3>Import from Strava</h3>

<p>dérive talks to the Strava API from your browser using <b>your own</b> API
application, so your activities are never sent through a third party.</p>

<ol>
    <li>Create an application on
        <a href="https://www.strava.com/settings/api" target="_blank"
           rel="noopener noreferrer">strava.com/settings/api</a>.</li>
    <li>Set its <i>Authorization Callback Domain</i> to
        <code>${escapeHtml(window.location.hostname)}</code>.</li>
    <li>Paste the credentials below.</li>
</ol>

<form id="strava-settings">
    <span class="form-row">
        <label>Client ID</label>
        <input name="clientId" type="text" inputmode="numeric"
            autocomplete="off" value="${escapeHtml(config.clientId || '')}">
    </span>

    <span class="form-row">
        <label>Client secret</label>
        <input name="clientSecret" type="password" autocomplete="off"
            placeholder="${config.clientSecret ? 'unchanged' : ''}">
    </span>

    <span class="form-row">
        <label>Token proxy URL</label>
        <input name="tokenExchangeUrl" type="url" autocomplete="off"
            placeholder="optional"
            value="${escapeHtml(config.tokenExchangeUrl || '')}">
    </span>
</form>

<p><small>Strava does not support PKCE, so the token exchange needs the client
secret. It is stored in this browser only and sent to Strava alone. If you would
rather not keep a secret in the browser, host a small endpoint that performs the
exchange and put its URL in <i>Token proxy URL</i> instead.</small></p>

<span class="form-row">${actions}</span>

<p id="strava-status"></p>`;

    let modal = picoModal({
        content: modalContent,
        closeButton: true,
        escCloses: true,
        overlayClose: true,
        overlayStyles: (styles) => {
            styles.opacity = 0.1;
        },
    });

    modal.afterCreate(() => {
        const elements = document.getElementById('strava-settings').elements;
        const status = document.getElementById('strava-status');

        const connectButton = document.getElementById('strava-connect');
        if (connectButton) {
            connectButton.addEventListener('click', () => {
                try {
                    strava.saveConfig({
                        clientId: elements.clientId.value,
                        clientSecret: elements.clientSecret.value || config.clientSecret,
                        tokenExchangeUrl: elements.tokenExchangeUrl.value.trim(),
                    });
                    strava.beginAuthorization();
                } catch (err) {
                    status.className = 'failures';
                    status.textContent = err.message;
                }
            });
        }

        const importButton = document.getElementById('strava-import');
        if (importButton) {
            importButton.addEventListener('click', () => {
                modal.close();
                importStravaActivities(map);
            });
        }

        const disconnectButton = document.getElementById('strava-disconnect');
        if (disconnectButton) {
            disconnectButton.addEventListener('click', async () => {
                await strava.disconnect();
                strava.forgetConfig();
                modal.close();
            });
        }
    });

    modal.afterClose(() => modal.destroy());

    return modal;
}


async function handleStravaRedirect(map) {
    try {
        if (await strava.completeRedirect()) {
            await importStravaActivities(map);
        }
    } catch (err) {
        console.error(err);
        let modal = buildStravaProgressModal();
        modal.show();
        modal.setContent(`
            <h3>Strava authorization failed</h3>
            <p class="failures">${escapeHtml(err.message)}</p>`);
        modal.allowClose();
    }
}


const INTRO_MODAL_SEEN_KEY = 'intro-modal-seen';

export function initialize(map) {
    // We don't need to show the help modal every time, only the first
    // time the user sees the page.
    let displayIntroModal = !strava.hasPendingRedirect();

    if (window.sessionStorage.getItem(INTRO_MODAL_SEEN_KEY) !== null) {
        displayIntroModal = false;
    } else {
        window.sessionStorage.setItem(INTRO_MODAL_SEEN_KEY, 'true');
    }


    let modal = displayIntroModal ? showModal('help') : null;

    window.addEventListener('dragover', handleDragOver, false);
    window.addEventListener('drop', e => {
        if (displayIntroModal && !modal.destroyed) {
            modal.destroy();
            modal.destroyed = true;
        }
        handleFileSelect(map, e);
    }, false);

    handleStravaRedirect(map);
}
