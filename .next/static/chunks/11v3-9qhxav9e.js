;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="92dae89a-4a3f-a7a6-b21c-fa93d08b53d4")}catch(e){}}();
(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,87984,t=>{"use strict";var e,r,o,i,n,s,a,h=Object.defineProperty,l=Object.getOwnPropertyNames,u=(t,e)=>function(){return t&&(e=(0,t[l(t)[0]])(t=0)),e},c=(t,e)=>{for(var r in e)h(t,r,{get:e[r],enumerable:!0})};function m(t){let e=t/255;return e<=.04045?e/12.92:Math.pow((e+.055)/1.055,2.4)}function f(t){return Math.round(Math.max(0,Math.min(255,255*(t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055))))}function g(t,e,r){let o=m(t),i=m(e),n=m(r),s=Math.cbrt(.4122214708*o+.5363325363*i+.0514459929*n),a=Math.cbrt(.2119034982*o+.6806995451*i+.1073969566*n),h=Math.cbrt(.0883024619*o+.2817188376*i+.6299787005*n),l=1.9779984951*s-2.428592205*a+.4505937099*h,u=.0259040371*s+.7827717662*a-.808675766*h,c=Math.sqrt(l*l+u*u),f=180/Math.PI*Math.atan2(u,l);return f<0&&(f+=360),{l:.2104542553*s+.793617785*a-.0040720468*h,c:c,h:f}}var d=u({"src/color-space.ts"(){}});function p(t,e){return(Math.max(t,e)+.05)/(Math.min(t,e)+.05)}function v(t,r,o,i,n=0){return new e(t,r,o,i,n)}var b=u({"src/color.ts"(){d(),e=class{constructor(t,e,r,o,i){this._r=t,this._g=e,this._b=r,this.population=o,this.proportion=i}rgb(){return{r:this._r,g:this._g,b:this._b}}hex(){let t=t=>t.toString(16).padStart(2,"0");return`#${t(this._r)}${t(this._g)}${t(this._b)}`}hsl(){return this._hsl||(this._hsl=function(t,e,r){let o=t/255,i=e/255,n=r/255,s=Math.max(o,i,n),a=Math.min(o,i,n),h=(s+a)/2,l=0,u=0;if(s!==a){let t=s-a;u=h>.5?t/(2-s-a):t/(s+a),l=s===o?((i-n)/t+6*(i<n))/6:s===i?((n-o)/t+2)/6:((o-i)/t+4)/6}return{h:Math.round(360*l),s:Math.round(100*u),l:Math.round(100*h)}}(this._r,this._g,this._b)),this._hsl}oklch(){return this._oklch||(this._oklch=g(this._r,this._g,this._b)),this._oklch}css(t="rgb"){switch(t){case"hsl":{let{h:t,s:e,l:r}=this.hsl();return`hsl(${t}, ${e}%, ${r}%)`}case"oklch":{let{l:t,c:e,h:r}=this.oklch();return`oklch(${t.toFixed(3)} ${e.toFixed(3)} ${r.toFixed(1)})`}default:return`rgb(${this._r}, ${this._g}, ${this._b})`}}array(){return[this._r,this._g,this._b]}toString(){return this.hex()}get textColor(){return this.isDark?"#ffffff":"#000000"}get luminance(){var t,e,r;let o;return void 0===this._luminance&&(this._luminance=(t=this._r,e=this._g,r=this._b,.2126*(o=t=>{let e=t/255;return e<=.04045?e/12.92:Math.pow((e+.055)/1.055,2.4)})(t)+.7152*o(e)+.0722*o(r))),this._luminance}get isDark(){return this.luminance<=.179}get isLight(){return!this.isDark}get contrast(){if(!this._contrast){let t=this.luminance,e=p(t,1),r=p(t,0),o=this.isDark?v(255,255,255,0,0):v(0,0,0,0,0);this._contrast={white:Math.round(100*e)/100,black:Math.round(100*r)/100,foreground:o}}return this._contrast}}}});function x(t){let{colorCount:e,quality:r}=t;if(void 0!==e&&Number.isInteger(e))if(1===e)throw Error("colorCount should be between 2 and 20. To get one color, call getColor() instead of getPalette()");else e=Math.min(e=Math.max(e,2),20);else e=10;(void 0===r||!Number.isInteger(r)||r<1)&&(r=10);let o=void 0===t.ignoreWhite||!!t.ignoreWhite,i="number"==typeof t.whiteThreshold?t.whiteThreshold:250,n="number"==typeof t.alphaThreshold?t.alphaThreshold:125;return{colorCount:e,quality:r,ignoreWhite:o,whiteThreshold:i,alphaThreshold:n,minSaturation:"number"==typeof t.minSaturation?Math.max(0,Math.min(1,t.minSaturation)):0,colorSpace:t.colorSpace??"oklch"}}function w(t,e,r,o){let{ignoreWhite:i=!0,whiteThreshold:n=250,alphaThreshold:s=125,minSaturation:a=0}=o,h=[];for(let o=0;o<e;o+=r){let e=4*o,r=t[e],l=t[e+1],u=t[e+2],c=t[e+3];if((void 0===c||!(c<s))&&(!i||!(r>n)||!(l>n)||!(u>n))){if(a>0){let t=Math.max(r,l,u);if(0===t||(t-Math.min(r,l,u))/t<a)continue}h.push([r,l,u])}}return h}function _(t,e,r){let o=0,i=0,n=0,s=0;for(let a=0;a<e;a+=r){let e=4*a;o+=t[e],i+=t[e+1],n+=t[e+2],s++}return 0===s?null:[Math.round(o/s),Math.round(i/s),Math.round(n/s)]}function M(t,e,r,o,i){let n,s=e*r,a={ignoreWhite:o.ignoreWhite,whiteThreshold:o.whiteThreshold,alphaThreshold:o.alphaThreshold,minSaturation:o.minSaturation},h=w(t,s,o.quality,a);if(0===h.length&&(h=w(t,s,o.quality,{...a,ignoreWhite:!1})),0===h.length&&(h=w(t,s,o.quality,{...a,ignoreWhite:!1,alphaThreshold:0})),"oklch"===o.colorSpace){let t=function(t){let e=Array(t.length);for(let r=0;r<t.length;r++){let[o,i,n]=t[r],{l:s,c:a,h}=g(o,i,n);e[r]=[Math.round(255*s),Math.round(a/.4*255),Math.round(h/360*255)]}return e}(h);n=i.quantize(t,o.colorCount).map(({color:[t,e,r],population:o})=>{var i,n;let s,a,h,l,u,c,m,g,d;return{color:(i=t/255,a=(n=e/255*.4)*Math.cos(s=Math.PI/180*(r/255*360)),l=i+.3963377774*a+.2158037573*(h=n*Math.sin(s)),u=i-.1055613458*a-.0638541728*h,c=i-.0894841775*a-1.291485548*h,[f(4.0767416621*(m=l*l*l)-3.3077115913*(g=u*u*u)+.2309699292*(d=c*c*c)),f(-1.2684380046*m+2.6097574011*g-.3413193965*d),f(-.0041960863*m-.7034186147*g+1.707614701*d)]),population:o}})}else n=i.quantize(h,o.colorCount);if(n.length>0){let t=n.reduce((t,e)=>t+e.population,0);return n.map(({color:[e,r,o],population:i})=>v(e,r,o,i,t>0?i/t:0))}let l=_(t,s,o.quality);return l?[v(l[0],l[1],l[2],1,1)]:null}c({},{computeFallbackColor:()=>_,createPixelArray:()=>w,extractPalette:()=>M,validateOptions:()=>x});var I=u({"src/pipeline.ts"(){b(),d()}});c({},{BrowserPixelLoader:()=>r});var k=u({"src/loaders/browser.ts"(){r=class{async load(t){if("u">typeof HTMLImageElement&&t instanceof HTMLImageElement)return this.loadFromImage(t);if("u">typeof HTMLCanvasElement&&t instanceof HTMLCanvasElement)return this.loadFromCanvas(t);if("u">typeof ImageData&&t instanceof ImageData)return{data:t.data,width:t.width,height:t.height};if("u">typeof HTMLVideoElement&&t instanceof HTMLVideoElement)return this.loadFromVideo(t);if("u">typeof ImageBitmap&&t instanceof ImageBitmap)return this.loadFromImageBitmap(t);if("u">typeof OffscreenCanvas&&t instanceof OffscreenCanvas)return this.loadFromOffscreenCanvas(t);throw Error("Unsupported source type. Expected HTMLImageElement, HTMLCanvasElement, HTMLVideoElement, ImageData, ImageBitmap, or OffscreenCanvas.")}loadFromImage(t){if(!t.complete)throw Error('Image has not finished loading. Wait for the "load" event before calling getColor/getPalette.');if(!t.naturalWidth)throw Error("Image has no dimensions. It may not have loaded successfully.");let e=document.createElement("canvas"),r=e.getContext("2d"),o=e.width=t.naturalWidth,i=e.height=t.naturalHeight;r.drawImage(t,0,0,o,i);try{return{data:r.getImageData(0,0,o,i).data,width:o,height:i}}catch(t){if(t instanceof DOMException&&"SecurityError"===t.name){let e=Error('Image is tainted by cross-origin data. Add crossorigin="anonymous" to the <img> tag and ensure the server sends appropriate CORS headers.');throw e.cause=t,e}throw t}}loadFromCanvas(t){let e=t.getContext("2d"),{width:r,height:o}=t;return{data:e.getImageData(0,0,r,o).data,width:r,height:o}}loadFromVideo(t){if(t.readyState<2)throw Error('Video is not ready. Wait for the "loadeddata" or "canplay" event before calling getColor/getPalette.');let e=t.videoWidth,r=t.videoHeight;if(!e||!r)throw Error("Video has no dimensions. It may not have loaded successfully.");let o=document.createElement("canvas"),i=o.getContext("2d");return o.width=e,o.height=r,i.drawImage(t,0,0,e,r),{data:i.getImageData(0,0,e,r).data,width:e,height:r}}loadFromOffscreenCanvas(t){let e=t.getContext("2d");if(!e)throw Error("Could not get 2D context from OffscreenCanvas.");let{width:r,height:o}=t;return{data:e.getImageData(0,0,r,o).data,width:r,height:o}}loadFromImageBitmap(t){let e=document.createElement("canvas"),r=e.getContext("2d");return e.width=t.width,e.height=t.height,r.drawImage(t,0,0),{data:r.getImageData(0,0,t.width,t.height).data,width:t.width,height:t.height}}}}}),y=u({"src/worker/worker-script.ts"(){o=`
'use strict';

// -------------------------------------------------------------------------
// Inlined MMCQ (Modified Median Cut Quantization)
// -------------------------------------------------------------------------

var SIGBITS = 5;
var RSHIFT = 3;
var MAX_ITER = 1000;
var FRACT_POP = 0.75;
var HISTO_SIZE = 32768;

function colorIndex(r, g, b) {
    return (r << 10) + (g << 5) + b;
}

function getHisto(pixels) {
    var h = new Uint32Array(HISTO_SIZE);
    for (var i = 0; i < pixels.length; i++) {
        var p = pixels[i];
        h[colorIndex(p[0] >> RSHIFT, p[1] >> RSHIFT, p[2] >> RSHIFT)]++;
    }
    return h;
}

function VBox(r1, r2, g1, g2, b1, b2, histo) {
    this.r1 = r1; this.r2 = r2;
    this.g1 = g1; this.g2 = g2;
    this.b1 = b1; this.b2 = b2;
    this.histo = histo;
    this._count = -1;
    this._volume = -1;
    this._avg = null;
}

VBox.prototype.volume = function(force) {
    if (this._volume < 0 || force) {
        this._volume = (this.r2 - this.r1 + 1) * (this.g2 - this.g1 + 1) * (this.b2 - this.b1 + 1);
    }
    return this._volume;
};

VBox.prototype.count = function(force) {
    if (this._count < 0 || force) {
        var n = 0;
        for (var i = this.r1; i <= this.r2; i++)
            for (var j = this.g1; j <= this.g2; j++)
                for (var k = this.b1; k <= this.b2; k++)
                    n += this.histo[colorIndex(i, j, k)] || 0;
        this._count = n;
    }
    return this._count;
};

VBox.prototype.copy = function() {
    return new VBox(this.r1, this.r2, this.g1, this.g2, this.b1, this.b2, this.histo);
};

VBox.prototype.avg = function(force) {
    if (!this._avg || force) {
        var mult = 1 << RSHIFT;
        if (this.r1 === this.r2 && this.g1 === this.g2 && this.b1 === this.b2) {
            this._avg = [this.r1 << RSHIFT, this.g1 << RSHIFT, this.b1 << RSHIFT];
        } else {
            var ntot = 0, rsum = 0, gsum = 0, bsum = 0;
            for (var i = this.r1; i <= this.r2; i++)
                for (var j = this.g1; j <= this.g2; j++)
                    for (var k = this.b1; k <= this.b2; k++) {
                        var hval = this.histo[colorIndex(i, j, k)] || 0;
                        ntot += hval;
                        rsum += hval * (i + 0.5) * mult;
                        gsum += hval * (j + 0.5) * mult;
                        bsum += hval * (k + 0.5) * mult;
                    }
            this._avg = ntot
                ? [~~(rsum / ntot), ~~(gsum / ntot), ~~(bsum / ntot)]
                : [~~(mult * (this.r1 + this.r2 + 1) / 2), ~~(mult * (this.g1 + this.g2 + 1) / 2), ~~(mult * (this.b1 + this.b2 + 1) / 2)];
        }
    }
    return this._avg;
};

function PQueue(comparator) {
    this.contents = [];
    this.sorted = false;
    this.comparator = comparator;
}

PQueue.prototype.push = function(item) { this.contents.push(item); this.sorted = false; };
PQueue.prototype.pop = function() {
    if (!this.sorted) { this.contents.sort(this.comparator); this.sorted = true; }
    return this.contents.pop();
};
PQueue.prototype.size = function() { return this.contents.length; };

function vboxFromPixels(pixels, histo) {
    var rmin = 1e6, rmax = 0, gmin = 1e6, gmax = 0, bmin = 1e6, bmax = 0;
    for (var i = 0; i < pixels.length; i++) {
        var p = pixels[i];
        var rv = p[0] >> RSHIFT, gv = p[1] >> RSHIFT, bv = p[2] >> RSHIFT;
        if (rv < rmin) rmin = rv; if (rv > rmax) rmax = rv;
        if (gv < gmin) gmin = gv; if (gv > gmax) gmax = gv;
        if (bv < bmin) bmin = bv; if (bv > bmax) bmax = bv;
    }
    return new VBox(rmin, rmax, gmin, gmax, bmin, bmax, histo);
}

function medianCutApply(histo, vbox) {
    if (!vbox.count()) return undefined;
    if (vbox.count() === 1) return [vbox.copy(), null];

    var rw = vbox.r2 - vbox.r1 + 1;
    var gw = vbox.g2 - vbox.g1 + 1;
    var bw = vbox.b2 - vbox.b1 + 1;
    var maxw = Math.max(rw, gw, bw);
    var total = 0;
    var partialsum = [];
    var lookaheadsum = [];
    var i, j, k, sum;

    if (maxw === rw) {
        for (i = vbox.r1; i <= vbox.r2; i++) {
            sum = 0;
            for (j = vbox.g1; j <= vbox.g2; j++)
                for (k = vbox.b1; k <= vbox.b2; k++)
                    sum += histo[colorIndex(i, j, k)] || 0;
            total += sum; partialsum[i] = total;
        }
    } else if (maxw === gw) {
        for (i = vbox.g1; i <= vbox.g2; i++) {
            sum = 0;
            for (j = vbox.r1; j <= vbox.r2; j++)
                for (k = vbox.b1; k <= vbox.b2; k++)
                    sum += histo[colorIndex(j, i, k)] || 0;
            total += sum; partialsum[i] = total;
        }
    } else {
        for (i = vbox.b1; i <= vbox.b2; i++) {
            sum = 0;
            for (j = vbox.r1; j <= vbox.r2; j++)
                for (k = vbox.g1; k <= vbox.g2; k++)
                    sum += histo[colorIndex(j, k, i)] || 0;
            total += sum; partialsum[i] = total;
        }
    }

    partialsum.forEach(function(d, idx) { lookaheadsum[idx] = total - d; });

    function doCut(color) {
        var dim1 = color + '1', dim2 = color + '2';
        for (var i = vbox[dim1]; i <= vbox[dim2]; i++) {
            if (partialsum[i] > total / 2) {
                var vbox1 = vbox.copy(), vbox2 = vbox.copy();
                var left = i - vbox[dim1], right = vbox[dim2] - i;
                var d2 = left <= right
                    ? Math.min(vbox[dim2] - 1, ~~(i + right / 2))
                    : Math.max(vbox[dim1], ~~(i - 1 - left / 2));
                while (!partialsum[d2]) d2++;
                var count2 = lookaheadsum[d2];
                while (!count2 && partialsum[d2 - 1]) count2 = lookaheadsum[--d2];
                vbox1[dim2] = d2;
                vbox2[dim1] = d2 + 1;
                return [vbox1, vbox2];
            }
        }
    }

    if (maxw === rw) return doCut('r');
    if (maxw === gw) return doCut('g');
    return doCut('b');
}

function iterate(pq, target, histo) {
    var ncolors = pq.size(), niters = 0;
    while (niters < MAX_ITER) {
        if (ncolors >= target) return;
        niters++;
        var vbox = pq.pop();
        if (!vbox.count()) { pq.push(vbox); continue; }
        var result = medianCutApply(histo, vbox);
        if (!result || !result[0]) return;
        pq.push(result[0]);
        if (result[1]) { pq.push(result[1]); ncolors++; }
    }
}

function quantize(pixels, maxColors) {
    if (!pixels.length || maxColors < 2 || maxColors > 256) return [];

    var histo = getHisto(pixels);
    var vbox = vboxFromPixels(pixels, histo);
    var pq = new PQueue(function(a, b) { return a.count() - b.count(); });
    pq.push(vbox);
    iterate(pq, FRACT_POP * maxColors, histo);

    var pq2 = new PQueue(function(a, b) { return a.count() * a.volume() - b.count() * b.volume(); });
    while (pq.size()) pq2.push(pq.pop());
    iterate(pq2, maxColors, histo);

    var results = [];
    while (pq2.size()) {
        var box = pq2.pop();
        results.push({ color: box.avg(), population: box.count() });
    }
    return results;
}

// -------------------------------------------------------------------------
// Worker message handler
// -------------------------------------------------------------------------

self.onmessage = function (e) {
    var data = e.data;
    var id = data.id;
    try {
        var palette = quantize(data.pixels, data.maxColors);
        self.postMessage({ id: id, palette: palette });
    } catch (err) {
        self.postMessage({ id: id, error: err.message || 'Unknown worker error' });
    }
};
`}});function C(){return"u">typeof Worker}function T(t,e,r){return new Promise((h,l)=>{if(r?.aborted)return void l(r.reason??new DOMException("Aborted","AbortError"));let u=s++;a.set(u,{resolve:h,reject:l});let c=()=>{a.delete(u),l(r.reason??new DOMException("Aborted","AbortError"))};r?.addEventListener("abort",c,{once:!0});try{(function(){if(i)return i;if(!C())throw Error("Web Workers are not supported in this environment.");return(i=new Worker(n=URL.createObjectURL(new Blob([o],{type:"application/javascript"})))).onmessage=t=>{let{id:e,palette:r,error:o}=t.data,i=a.get(e);if(i)if(a.delete(e),o)i.reject(Error(o));else{let t=r.reduce((t,e)=>t+e.population,0),e=r.map(({color:[e,r,o],population:i})=>v(e,r,o,i,t>0?i/t:0));i.resolve(e)}},i.onerror=t=>{for(let[,e]of a)e.reject(Error(t.message));a.clear()},i})().postMessage({id:u,pixels:t,maxColors:e})}catch(t){a.delete(u),r?.removeEventListener("abort",c),l(t)}})}function E(){for(let[,t]of(i&&(i.terminate(),i=null),n&&(URL.revokeObjectURL(n),n=null),a))t.reject(Error("Worker terminated"));a.clear()}c({},{extractInWorker:()=>T,isWorkerSupported:()=>C,terminateWorker:()=>E}),u({"src/worker/manager.ts"(){b(),y(),i=null,n=null,s=0,a=new Map}}),I(),I(),b(),v(255,255,255,0),v(0,0,0,0);function j(t,e,r){return(t<<10)+(e<<5)+r}var S=class t{constructor(t,e,r,o,i,n,s){this.r1=t,this.r2=e,this.g1=r,this.g2=o,this.b1=i,this.b2=n,this.histo=s}volume(t=!1){return(void 0===this._volume||t)&&(this._volume=(this.r2-this.r1+1)*(this.g2-this.g1+1)*(this.b2-this.b1+1)),this._volume}count(t=!1){if(void 0===this._count||t){let t=0;for(let e=this.r1;e<=this.r2;e++)for(let r=this.g1;r<=this.g2;r++)for(let o=this.b1;o<=this.b2;o++)t+=this.histo[j(e,r,o)]||0;this._count=t}return this._count}copy(){return new t(this.r1,this.r2,this.g1,this.g2,this.b1,this.b2,this.histo)}avg(t=!1){if(void 0===this._avg||t){let t=8;if(this.r1===this.r2&&this.g1===this.g2&&this.b1===this.b2)this._avg=[this.r1<<3,this.g1<<3,this.b1<<3];else{let e=0,r=0,o=0,i=0;for(let n=this.r1;n<=this.r2;n++)for(let s=this.g1;s<=this.g2;s++)for(let a=this.b1;a<=this.b2;a++){let h=this.histo[j(n,s,a)]||0;e+=h,r+=h*(n+.5)*t,o+=h*(s+.5)*t,i+=h*(a+.5)*t}e?this._avg=[~~(r/e),~~(o/e),~~(i/e)]:this._avg=[~~(t*(this.r1+this.r2+1)/2),~~(t*(this.g1+this.g2+1)/2),~~(t*(this.b1+this.b2+1)/2)]}}return this._avg}},F=class{constructor(t){this.comparator=t,this.contents=[],this.sorted=!1}sort(){this.contents.sort(this.comparator),this.sorted=!0}push(t){this.contents.push(t),this.sorted=!1}peek(t){return this.sorted||this.sort(),this.contents[t??this.contents.length-1]}pop(){return this.sorted||this.sort(),this.contents.pop()}size(){return this.contents.length}map(t){return this.contents.map(t)}};function q(t,e,r){let o=t.size(),i=0;for(;i<1e3;){if(o>=e)return;i++;let n=t.pop();if(!n.count()){t.push(n);continue}let s=function(t,e){if(!e.count())return;if(1===e.count())return[e.copy(),null];let r=e.r2-e.r1+1,o=e.g2-e.g1+1,i=Math.max(r,o,e.b2-e.b1+1),n=0,s=[],a=[];if(i===r)for(let r=e.r1;r<=e.r2;r++){let o=0;for(let i=e.g1;i<=e.g2;i++)for(let n=e.b1;n<=e.b2;n++)o+=t[j(r,i,n)]||0;n+=o,s[r]=n}else if(i===o)for(let r=e.g1;r<=e.g2;r++){let o=0;for(let i=e.r1;i<=e.r2;i++)for(let n=e.b1;n<=e.b2;n++)o+=t[j(i,r,n)]||0;n+=o,s[r]=n}else for(let r=e.b1;r<=e.b2;r++){let o=0;for(let i=e.r1;i<=e.r2;i++)for(let n=e.g1;n<=e.g2;n++)o+=t[j(i,n,r)]||0;n+=o,s[r]=n}function h(t){let r=t+"1",o=t+"2";for(let t=e[r];t<=e[o];t++)if(s[t]>n/2){let i,n=e.copy(),h=e.copy(),l=t-e[r],u=e[o]-t;for(i=l<=u?Math.min(e[o]-1,~~(t+u/2)):Math.max(e[r],~~(t-1-l/2));!s[i];)i++;let c=a[i];for(;!c&&s[i-1];)c=a[--i];return n[o]=i,h[r]=n[o]+1,[n,h]}}return h((s.forEach((t,e)=>{a[e]=n-t}),i===r)?"r":i===o?"g":"b")}(r,n);if(!s||!s[0])return;t.push(s[0]),s[1]&&(t.push(s[1]),o++)}}var H=class{async init(){}quantize(t,e){return function(t,e){if(!t.length||e<2||e>256)return[];let r=new Set,o=[];for(let e of t){let t=e.join(",");r.has(t)||(r.add(t),o.push(e))}if(o.length<=e){let e=new Map;for(let r of t){let t=r.join(",");e.set(t,(e.get(t)||0)+1)}return o.map(t=>({color:t,population:e.get(t.join(","))}))}let i=function(t){let e=new Uint32Array(32768);for(let r of t){let t=r[0]>>3,o=r[1]>>3,i=r[2]>>3;e[j(t,o,i)]++}return e}(t),n=function(t,e){let r=1e6,o=0,i=1e6,n=0,s=1e6,a=0;for(let e of t){let t=e[0]>>3,h=e[1]>>3,l=e[2]>>3;t<r?r=t:t>o&&(o=t),h<i?i=h:h>n&&(n=h),l<s?s=l:l>a&&(a=l)}return new S(r,o,i,n,s,a,e)}(t,i),s=new F((t,e)=>t.count()-e.count());s.push(n),q(s,.75*e,i);let a=new F((t,e)=>t.count()*t.volume()-e.count()*e.volume());for(;s.size();)a.push(s.pop());q(a,e,i);let h=[];for(;a.size();){let t=a.pop();h.push({color:t.avg(),population:t.count()})}return h}(t,e)}};k(),I(),new r,new H,b(),t.s([])}]);

//# debugId=92dae89a-4a3f-a7a6-b21c-fa93d08b53d4