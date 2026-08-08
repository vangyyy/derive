import exifr from 'exifr';


export default class Image {
    constructor(imageFile) {
        this.imageFile = imageFile;
        this.exifPromise = null;
    }

    async hasGeolocationData() {
        const gps = await this.gps();
        return gps !== null;
    }

    async width() {
        const exif = await this.exif();
        return exif ? exif.ExifImageWidth : undefined;
    }

    async height() {
        const exif = await this.exif();
        return exif ? exif.ExifImageHeight : undefined;
    }

    async latitude() {
        const gps = await this.gps();

        if (gps === null) { throw 'No latitude data'; }

        return gps.latitude;
    }

    async longitude() {
        const gps = await this.gps();

        if (gps === null) { throw 'No longitude data'; }

        return gps.longitude;
    }

    exif() {
        if (this.exifPromise === null) {
            this.exifPromise = exifr
                .parse(this.imageFile, {gps: true})
                .catch(() => null);
        }

        return this.exifPromise;
    }

    async gps() {
        const exif = await this.exif();

        if (!exif ||
            !Number.isFinite(exif.latitude) ||
            !Number.isFinite(exif.longitude)) {
            return null;
        }

        return {latitude: exif.latitude, longitude: exif.longitude};
    }

    async getImageData() {
        return new Promise(resolve => {
            let reader = new FileReader();
            reader.onload = () => {
                return resolve(reader.result);
            };
            reader.readAsDataURL(this.imageFile, 'UTF-8');
        });
    }

}
