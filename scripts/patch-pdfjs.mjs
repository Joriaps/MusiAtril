// Parches a PDF.js 2.8.335. Cada sustitución exige coincidencias exactas: si una versión
// distinta no encaja, el build falla en vez de publicar un visor sin proteger.
export function sub(code, from, to, times, label) {
  const n = code.split(from).length - 1;
  if (n !== times) throw new Error(`Parche PDF.js "${label}": esperaba ${times} coincidencias, hay ${n}`);
  return code.split(from).join(to);
}
// regenerator y core-js llevan un Function(...) de reserva que la CSP bloquea; el primero
// SÍ se alcanza en modo estricto y, sin este parche, PDF.js no arranca.
const strip = (c) => {
  c = c.replace(/\/\/# sourceMappingURL=.*\s*$/, '');
  c = sub(c, 'Function("r", "regeneratorRuntime = r")(runtime);', '', 1, 'regenerator');
  c = sub(c, ' : Function(fn)).apply', ' : null).apply', 1, 'core-js setImmediate');
  return sub(c, "Function('return this')()", 'self', 1, 'core-js global');
};

export function patchMain(c) {
  c = strip(c);
  c = sub(c, 'new Function("");\n    return true;', 'return false;', 1, 'isEvalSupported');
  c = sub(c, 'worker = eval("require")(_getWorkerSrc());', 'throw new Error("no disponible");', 1, 'eval require');
  c = sub(c, 'new Function("c", "size", js)', 'function () { throw new Error("eval desactivado"); }', 1, 'glifos (CVE-2024-4367)');
  return c;
}

export function patchWorker(c, prelude) {
  c = strip(c);
  c = sub(c, 'new Function("");\n    return true;', 'return false;', 1, 'isEvalSupported');
  c = sub(c, 'new Function("src", "srcOffset", "dest", "destOffset", compiled)', 'null', 1, 'funciones PostScript');
  // JPEG: decodificación reducida
  c = sub(c, 'component.blockData = new Int16Array(blocksBufferSize);',
    'var af = atrilPrepare(frame, component);\n          component.blockData = af ? atrilFill(new Int16Array(blocksBufferSize / (af * af))) : new Int16Array(blocksBufferSize);', 1, 'jpeg prepare');
  c = sub(c, '      decode(component, blockOffset);\n    }', '      atrilDecode(decode, component, blockOffset, quantizeAndInverse);\n    }', 2, 'jpeg decode');
  c = sub(c, 'components.push(component);\n            }\n\n            var spectralStart',
    'component.quantizationTable = quantizationTables[component.quantizationId] || component.quantizationTable;\n              components.push(component);\n            }\n\n            var spectralStart', 1, 'jpeg qt');
  c = sub(c, 'function buildComponentData(frame, component) {',
    'function buildComponentData(frame, component) {\n    if (component.atrilF > 1) return component.blockData;', 1, 'jpeg build');
  c = sub(c, 'output: buildComponentData(frame, component),',
    'output: buildComponentData(frame, component),\n          atrilF: component.atrilF,', 1, 'jpeg componente');
  c = sub(c, '        offset = i;\n        output = component.output;',
    '        offset = i;\n        output = component.output;\n        if (atrilLinearize(component, data, i, width, height, numComponents, componentScaleX, componentScaleY)) continue;', 1, 'jpeg linearize');
  // Imágenes
  c = sub(c, '      imgArray = this.getImageBytes(originalHeight * rowBytes);\n      var actualHeight',
    '      var jf = this.image instanceof _jpeg_stream.JpegStream && bpc === 8 ? atrilFactor(originalWidth, originalHeight) : 1;\n      if (jf > 1) {\n        originalWidth = Math.ceil(originalWidth / jf);\n        originalHeight = Math.ceil(originalHeight / jf);\n        imgData.width = drawWidth = Math.ceil(drawWidth / jf);\n        imgData.height = drawHeight = Math.ceil(drawHeight / jf);\n        rowBytes = originalWidth * numComps;\n      }\n      imgArray = jf > 1 ? this.getImageBytes(originalHeight * rowBytes, originalWidth, originalHeight) : this.getImageBytes(originalHeight * rowBytes);\n      var actualHeight', 1, 'jpeg genérico');
  c = sub(c, 'key: "createImageData",\n    value: function createImageData() {\n      var forceRGBA',
    'key: "createImageData",\n    value: function createImageData(f) {\n      return atrilShrink(this.atrilCreateImageData(f));\n    }\n  }, {\n    key: "atrilCreateImageData",\n    value: function atrilCreateImageData() {\n      var forceRGBA', 1, 'createImageData');
  c = sub(c, 'if (kind && !this.smask && !this.mask && drawWidth === originalWidth',
    'if (kind && !(this.image instanceof _jpeg_stream.JpegStream && kind === _util.ImageKind.RGB_24BPP && atrilFactor(drawWidth, drawHeight) > 1) && !this.smask && !this.mask && drawWidth === originalWidth', 1, 'jpeg rgb directo');
  c = sub(c, 'imgData.data = this.getImageBytes(imageLength, drawWidth, drawHeight, true);',
    'var af = atrilFactor(drawWidth, drawHeight);\n              imgData.width = Math.ceil(drawWidth / af);\n              imgData.height = Math.ceil(drawHeight / af);\n              imgData.data = this.getImageBytes(imageLength, imgData.width, imgData.height, true);', 1, 'jpeg tamaño');
  c = sub(c, '      return {\n        data: data,\n        width: width,\n        height: height\n      };\n    }\n  }]);\n\n  return PDFImage;',
    '      return atrilShrinkMask({\n        data: data,\n        width: width,\n        height: height\n      });\n    }\n  }]);\n\n  return PDFImage;', 1, 'máscara');
  return prelude + '\n' + c;
}
