/* Lo poco que falta en Safari 10 y no cubre PDF.js. ES5 puro. */
(function () {
  'use strict';
  if (!('globalThis' in window)) window.globalThis = window;
  var P = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (P && !P.resetTransform) {
    P.resetTransform = function () { this.setTransform(1, 0, 0, 1, 0, 0); };
  }
  if (window.Promise && !Promise.prototype['finally']) {
    Promise.prototype['finally'] = function (fn) {
      return this.then(function (v) {
        return Promise.resolve(fn()).then(function () { return v; });
      }, function (e) {
        return Promise.resolve(fn()).then(function () { throw e; });
      });
    };
  }
})();
