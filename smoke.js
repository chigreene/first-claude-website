/* WebGL fluid smoke cursor effect — vanilla JS port
   Navier-Stokes fluid simulation with soft gray/white smoke tones.
   Gated behind prefers-reduced-motion and fine pointer checks. */
(function () {
  "use strict";

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var canvas = document.getElementById("smoke-canvas");
  if (!canvas) return;

  var config = {
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: 1440,
    DENSITY_DISSIPATION: 3.5,
    VELOCITY_DISSIPATION: 2,
    PRESSURE: 0.1,
    PRESSURE_ITERATIONS: 20,
    CURL: 3,
    SPLAT_RADIUS: 0.2,
    SPLAT_FORCE: 6000,
    SHADING: true,
    COLOR_UPDATE_SPEED: 10,
    TRANSPARENT: true
  };

  var gl, ext;
  var pointers = [{
    id: -1, texcoordX: 0, texcoordY: 0,
    prevTexcoordX: 0, prevTexcoordY: 0,
    deltaX: 0, deltaY: 0,
    down: false, moved: false,
    color: { r: 0, g: 0, b: 0 }
  }];

  var dye, velocity, divergenceFBO, curlFBO, pressureFBO;
  var lastUpdateTime = Date.now();
  var colorUpdateTimer = 0;
  var animationId = null;

  var copyProgram, clearProgram, splatProgram, advectionProgram;
  var divergenceProgram, curlProgram, vorticityProgram, pressureProgram;
  var gradientSubtractProgram, displayMaterial;
  var blit;

  var params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
  gl = canvas.getContext("webgl2", params) || canvas.getContext("webgl", params) || canvas.getContext("experimental-webgl", params);
  if (!gl) return;

  var isWebGL2 = "drawBuffers" in gl;
  var supportLinearFiltering = false;
  var halfFloat = null;

  if (isWebGL2) {
    gl.getExtension("EXT_color_buffer_float");
    supportLinearFiltering = !!gl.getExtension("OES_texture_float_linear");
  } else {
    halfFloat = gl.getExtension("OES_texture_half_float");
    supportLinearFiltering = !!gl.getExtension("OES_texture_half_float_linear");
  }

  gl.clearColor(0, 0, 0, 0);

  var halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : (halfFloat && halfFloat.HALF_FLOAT_OES) || 0;

  function getSupportedFormat(internalFormat, format, type) {
    if (!supportRenderTextureFormat(internalFormat, format, type)) {
      if (isWebGL2) {
        switch (internalFormat) {
          case gl.R16F: return getSupportedFormat(gl.RG16F, gl.RG, type);
          case gl.RG16F: return getSupportedFormat(gl.RGBA16F, gl.RGBA, type);
          default: return null;
        }
      }
      return null;
    }
    return { internalFormat: internalFormat, format: format };
  }

  function supportRenderTextureFormat(internalFormat, format, type) {
    var texture = gl.createTexture();
    if (!texture) return false;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
    var fbo = gl.createFramebuffer();
    if (!fbo) { gl.deleteTexture(texture); return false; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(texture);
    return ok;
  }

  var formatRGBA, formatRG, formatR;
  if (isWebGL2) {
    formatRGBA = getSupportedFormat(gl.RGBA16F, gl.RGBA, halfFloatTexType);
    formatRG = getSupportedFormat(gl.RG16F, gl.RG, halfFloatTexType);
    formatR = getSupportedFormat(gl.R16F, gl.RED, halfFloatTexType);
  } else {
    formatRGBA = getSupportedFormat(gl.RGBA, gl.RGBA, halfFloatTexType);
    formatRG = getSupportedFormat(gl.RGBA, gl.RGBA, halfFloatTexType);
    formatR = getSupportedFormat(gl.RGBA, gl.RGBA, halfFloatTexType);
  }

  if (!formatRGBA || !formatRG || !formatR) return;

  ext = {
    formatRGBA: formatRGBA, formatRG: formatRG, formatR: formatR,
    halfFloatTexType: halfFloatTexType,
    supportLinearFiltering: supportLinearFiltering
  };

  if (!ext.supportLinearFiltering) {
    config.DYE_RESOLUTION = 256;
    config.SHADING = false;
  }

  function compileShader(type, source, keywords) {
    var src = source;
    if (keywords) {
      var kw = "";
      for (var i = 0; i < keywords.length; i++) kw += "#define " + keywords[i] + "\n";
      src = kw + source;
    }
    var shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  function createProgramFromShaders(vs, fs) {
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    if (!p) return null;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
    return p;
  }

  function getUniforms(program) {
    var u = {};
    var count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < count; i++) {
      var info = gl.getActiveUniform(program, i);
      if (info) u[info.name] = gl.getUniformLocation(program, info.name);
    }
    return u;
  }

  function Program(vs, fs) {
    this.program = createProgramFromShaders(vs, fs);
    this.uniforms = this.program ? getUniforms(this.program) : {};
  }
  Program.prototype.bind = function () { if (this.program) gl.useProgram(this.program); };

  function Material(vs, fsSrc) {
    this.vertexShader = vs;
    this.fragmentShaderSource = fsSrc;
    this.programs = {};
    this.activeProgram = null;
    this.uniforms = {};
  }
  Material.prototype.setKeywords = function (keywords) {
    var hash = 0;
    for (var i = 0; i < keywords.length; i++) {
      var s = keywords[i];
      for (var j = 0; j < s.length; j++) { hash = (hash << 5) - hash + s.charCodeAt(j); hash |= 0; }
    }
    var p = this.programs[hash];
    if (!p) {
      var fs = compileShader(gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
      p = createProgramFromShaders(this.vertexShader, fs);
      this.programs[hash] = p;
    }
    if (p === this.activeProgram) return;
    if (p) this.uniforms = getUniforms(p);
    this.activeProgram = p;
  };
  Material.prototype.bind = function () { if (this.activeProgram) gl.useProgram(this.activeProgram); };

  // Shaders
  var baseVertexShader = compileShader(gl.VERTEX_SHADER,
    "precision highp float;\n" +
    "attribute vec2 aPosition;\n" +
    "varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;\n" +
    "uniform vec2 texelSize;\n" +
    "void main(){vUv=aPosition*0.5+0.5;vL=vUv-vec2(texelSize.x,0);vR=vUv+vec2(texelSize.x,0);vT=vUv+vec2(0,texelSize.y);vB=vUv-vec2(0,texelSize.y);gl_Position=vec4(aPosition,0,1);}"
  );

  var copyShader = compileShader(gl.FRAGMENT_SHADER,
    "precision mediump float;precision mediump sampler2D;varying highp vec2 vUv;uniform sampler2D uTexture;void main(){gl_FragColor=texture2D(uTexture,vUv);}"
  );

  var clearShader = compileShader(gl.FRAGMENT_SHADER,
    "precision mediump float;precision mediump sampler2D;varying highp vec2 vUv;uniform sampler2D uTexture;uniform float value;void main(){gl_FragColor=value*texture2D(uTexture,vUv);}"
  );

  var displayShaderSource =
    "precision highp float;precision highp sampler2D;" +
    "varying vec2 vUv;varying vec2 vL;varying vec2 vR;varying vec2 vT;varying vec2 vB;" +
    "uniform sampler2D uTexture;uniform vec2 texelSize;" +
    "void main(){vec3 c=texture2D(uTexture,vUv).rgb;" +
    "#ifdef SHADING\n" +
    "vec3 lc=texture2D(uTexture,vL).rgb;vec3 rc=texture2D(uTexture,vR).rgb;" +
    "vec3 tc=texture2D(uTexture,vT).rgb;vec3 bc=texture2D(uTexture,vB).rgb;" +
    "float dx=length(rc)-length(lc);float dy=length(tc)-length(bc);" +
    "vec3 n=normalize(vec3(dx,dy,length(texelSize)));vec3 l=vec3(0,0,1);" +
    "float diffuse=clamp(dot(n,l)+0.7,0.7,1.0);c*=diffuse;\n" +
    "#endif\n" +
    "float a=max(c.r,max(c.g,c.b));gl_FragColor=vec4(c,a);}";

  var splatShader = compileShader(gl.FRAGMENT_SHADER,
    "precision highp float;precision highp sampler2D;varying vec2 vUv;uniform sampler2D uTarget;uniform float aspectRatio;uniform vec3 color;uniform vec2 point;uniform float radius;" +
    "void main(){vec2 p=vUv-point.xy;p.x*=aspectRatio;vec3 splat=exp(-dot(p,p)/radius)*color;vec3 base=texture2D(uTarget,vUv).xyz;gl_FragColor=vec4(base+splat,1);}"
  );

  var advectionShader = compileShader(gl.FRAGMENT_SHADER,
    "precision highp float;precision highp sampler2D;varying vec2 vUv;uniform sampler2D uVelocity;uniform sampler2D uSource;uniform vec2 texelSize;uniform vec2 dyeTexelSize;uniform float dt;uniform float dissipation;" +
    "vec4 bilerp(sampler2D sam,vec2 uv,vec2 tsize){vec2 st=uv/tsize-0.5;vec2 iuv=floor(st);vec2 fuv=fract(st);" +
    "vec4 a=texture2D(sam,(iuv+vec2(0.5,0.5))*tsize);vec4 b=texture2D(sam,(iuv+vec2(1.5,0.5))*tsize);" +
    "vec4 c=texture2D(sam,(iuv+vec2(0.5,1.5))*tsize);vec4 d=texture2D(sam,(iuv+vec2(1.5,1.5))*tsize);" +
    "return mix(mix(a,b,fuv.x),mix(c,d,fuv.x),fuv.y);}" +
    "void main(){" +
    "#ifdef MANUAL_FILTERING\n" +
    "vec2 coord=vUv-dt*bilerp(uVelocity,vUv,texelSize).xy*texelSize;vec4 result=bilerp(uSource,coord,dyeTexelSize);\n" +
    "#else\n" +
    "vec2 coord=vUv-dt*texture2D(uVelocity,vUv).xy*texelSize;vec4 result=texture2D(uSource,coord);\n" +
    "#endif\n" +
    "float decay=1.0+dissipation*dt;gl_FragColor=result/decay;}",
    ext.supportLinearFiltering ? null : ["MANUAL_FILTERING"]
  );

  var divergenceShader = compileShader(gl.FRAGMENT_SHADER,
    "precision mediump float;precision mediump sampler2D;varying highp vec2 vUv;varying highp vec2 vL;varying highp vec2 vR;varying highp vec2 vT;varying highp vec2 vB;uniform sampler2D uVelocity;" +
    "void main(){float L=texture2D(uVelocity,vL).x;float R=texture2D(uVelocity,vR).x;float T=texture2D(uVelocity,vT).y;float B=texture2D(uVelocity,vB).y;" +
    "vec2 C=texture2D(uVelocity,vUv).xy;if(vL.x<0.0){L=-C.x;}if(vR.x>1.0){R=-C.x;}if(vT.y>1.0){T=-C.y;}if(vB.y<0.0){B=-C.y;}" +
    "float div=0.5*(R-L+T-B);gl_FragColor=vec4(div,0,0,1);}"
  );

  var curlShader = compileShader(gl.FRAGMENT_SHADER,
    "precision mediump float;precision mediump sampler2D;varying highp vec2 vUv;varying highp vec2 vL;varying highp vec2 vR;varying highp vec2 vT;varying highp vec2 vB;uniform sampler2D uVelocity;" +
    "void main(){float L=texture2D(uVelocity,vL).y;float R=texture2D(uVelocity,vR).y;float T=texture2D(uVelocity,vT).x;float B=texture2D(uVelocity,vB).x;" +
    "float vorticity=R-L-T+B;gl_FragColor=vec4(0.5*vorticity,0,0,1);}"
  );

  var vorticityShader = compileShader(gl.FRAGMENT_SHADER,
    "precision highp float;precision highp sampler2D;varying vec2 vUv;varying vec2 vL;varying vec2 vR;varying vec2 vT;varying vec2 vB;uniform sampler2D uVelocity;uniform sampler2D uCurl;uniform float curl;uniform float dt;" +
    "void main(){float L=texture2D(uCurl,vL).x;float R=texture2D(uCurl,vR).x;float T=texture2D(uCurl,vT).x;float B=texture2D(uCurl,vB).x;float C=texture2D(uCurl,vUv).x;" +
    "vec2 force=0.5*vec2(abs(T)-abs(B),abs(R)-abs(L));force/=length(force)+0.0001;force*=curl*C;force.y*=-1.0;" +
    "vec2 vel=texture2D(uVelocity,vUv).xy;vel+=force*dt;vel=min(max(vel,-1000.0),1000.0);gl_FragColor=vec4(vel,0,1);}"
  );

  var pressureShader = compileShader(gl.FRAGMENT_SHADER,
    "precision mediump float;precision mediump sampler2D;varying highp vec2 vUv;varying highp vec2 vL;varying highp vec2 vR;varying highp vec2 vT;varying highp vec2 vB;uniform sampler2D uPressure;uniform sampler2D uDivergence;" +
    "void main(){float L=texture2D(uPressure,vL).x;float R=texture2D(uPressure,vR).x;float T=texture2D(uPressure,vT).x;float B=texture2D(uPressure,vB).x;" +
    "float divergence=texture2D(uDivergence,vUv).x;float pressure=(L+R+B+T-divergence)*0.25;gl_FragColor=vec4(pressure,0,0,1);}"
  );

  var gradientSubtractShader = compileShader(gl.FRAGMENT_SHADER,
    "precision mediump float;precision mediump sampler2D;varying highp vec2 vUv;varying highp vec2 vL;varying highp vec2 vR;varying highp vec2 vT;varying highp vec2 vB;uniform sampler2D uPressure;uniform sampler2D uVelocity;" +
    "void main(){float L=texture2D(uPressure,vL).x;float R=texture2D(uPressure,vR).x;float T=texture2D(uPressure,vT).x;float B=texture2D(uPressure,vB).x;" +
    "vec2 vel=texture2D(uVelocity,vUv).xy;vel.xy-=vec2(R-L,T-B);gl_FragColor=vec4(vel,0,1);}"
  );

  copyProgram = new Program(baseVertexShader, copyShader);
  clearProgram = new Program(baseVertexShader, clearShader);
  splatProgram = new Program(baseVertexShader, splatShader);
  advectionProgram = new Program(baseVertexShader, advectionShader);
  divergenceProgram = new Program(baseVertexShader, divergenceShader);
  curlProgram = new Program(baseVertexShader, curlShader);
  vorticityProgram = new Program(baseVertexShader, vorticityShader);
  pressureProgram = new Program(baseVertexShader, pressureShader);
  gradientSubtractProgram = new Program(baseVertexShader, gradientSubtractShader);
  displayMaterial = new Material(baseVertexShader, displayShaderSource);

  // Blit quad
  var buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,-1,1,1,1,1,-1]), gl.STATIC_DRAW);
  var elemBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elemBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2,0,2,3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  blit = function (target, doClear) {
    if (!gl) return;
    if (!target) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    if (doClear) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  };

  function createFBO(w, h, internalFormat, format, type, param) {
    gl.activeTexture(gl.TEXTURE0);
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      texture: texture, fbo: fbo, width: w, height: h,
      texelSizeX: 1 / w, texelSizeY: 1 / h,
      attach: function (id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, texture); return id; }
    };
  }

  function createDoubleFBO(w, h, internalFormat, format, type, param) {
    var fbo1 = createFBO(w, h, internalFormat, format, type, param);
    var fbo2 = createFBO(w, h, internalFormat, format, type, param);
    return {
      width: w, height: h, texelSizeX: fbo1.texelSizeX, texelSizeY: fbo1.texelSizeY,
      read: fbo1, write: fbo2,
      swap: function () { var t = this.read; this.read = this.write; this.write = t; }
    };
  }

  function getResolution(resolution) {
    var w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    var aspect = w / h;
    var a = aspect < 1 ? 1 / aspect : aspect;
    var min = Math.round(resolution), max = Math.round(resolution * a);
    return w > h ? { width: max, height: min } : { width: min, height: max };
  }

  function scaleByPixelRatio(input) {
    return Math.floor(input * (window.devicePixelRatio || 1));
  }

  function initFramebuffers() {
    var simRes = getResolution(config.SIM_RESOLUTION);
    var dyeRes = getResolution(config.DYE_RESOLUTION);
    var texType = ext.halfFloatTexType;
    var filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
    gl.disable(gl.BLEND);

    if (!dye) dye = createDoubleFBO(dyeRes.width, dyeRes.height, ext.formatRGBA.internalFormat, ext.formatRGBA.format, texType, filtering);
    if (!velocity) velocity = createDoubleFBO(simRes.width, simRes.height, ext.formatRG.internalFormat, ext.formatRG.format, texType, filtering);
    divergenceFBO = createFBO(simRes.width, simRes.height, ext.formatR.internalFormat, ext.formatR.format, texType, gl.NEAREST);
    curlFBO = createFBO(simRes.width, simRes.height, ext.formatR.internalFormat, ext.formatR.format, texType, gl.NEAREST);
    pressureFBO = createDoubleFBO(simRes.width, simRes.height, ext.formatR.internalFormat, ext.formatR.format, texType, gl.NEAREST);
  }

  // Soft gray/white smoke colors
  function generateColor() {
    var base = 0.55 + Math.random() * 0.35;
    var warm = (Math.random() - 0.5) * 0.06;
    return { r: (base + warm) * 0.15, g: base * 0.15, b: (base - warm * 0.5) * 0.16 };
  }

  function correctRadius(radius) {
    var ar = canvas.width / canvas.height;
    return ar > 1 ? radius * ar : radius;
  }
  function correctDeltaX(delta) { var ar = canvas.width / canvas.height; return ar < 1 ? delta * ar : delta; }
  function correctDeltaY(delta) { var ar = canvas.width / canvas.height; return ar > 1 ? delta / ar : delta; }

  function splatPointer(pointer) {
    var dx = pointer.deltaX * config.SPLAT_FORCE;
    var dy = pointer.deltaY * config.SPLAT_FORCE;
    doSplat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color);
  }

  function clickSplat(pointer) {
    var color = generateColor();
    color.r *= 10; color.g *= 10; color.b *= 10;
    var dx = 10 * (Math.random() - 0.5);
    var dy = 30 * (Math.random() - 0.5);
    doSplat(pointer.texcoordX, pointer.texcoordY, dx, dy, color);
  }

  function doSplat(x, y, dx, dy, color) {
    splatProgram.bind();
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProgram.uniforms.point, x, y);
    gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0);
    gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100));
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
    blit(dye.write);
    dye.swap();
  }

  function step(dt) {
    gl.disable(gl.BLEND);

    curlProgram.bind();
    gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(curlFBO);

    vorticityProgram.bind();
    gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curlFBO.attach(1));
    gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
    gl.uniform1f(vorticityProgram.uniforms.dt, dt);
    blit(velocity.write);
    velocity.swap();

    divergenceProgram.bind();
    gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergenceFBO);

    clearProgram.bind();
    gl.uniform1i(clearProgram.uniforms.uTexture, pressureFBO.read.attach(0));
    gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
    blit(pressureFBO.write);
    pressureFBO.swap();

    pressureProgram.bind();
    gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergenceFBO.attach(0));
    for (var i = 0; i < config.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(pressureProgram.uniforms.uPressure, pressureFBO.read.attach(1));
      blit(pressureFBO.write);
      pressureFBO.swap();
    }

    gradientSubtractProgram.bind();
    gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressureFBO.read.attach(0));
    gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    advectionProgram.bind();
    gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    if (!ext.supportLinearFiltering) gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    var velId = velocity.read.attach(0);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velId);
    gl.uniform1i(advectionProgram.uniforms.uSource, velId);
    gl.uniform1f(advectionProgram.uniforms.dt, dt);
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
    blit(velocity.write);
    velocity.swap();

    if (!ext.supportLinearFiltering) gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
    blit(dye.write);
    dye.swap();
  }

  function render() {
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);
    displayMaterial.bind();
    if (config.SHADING) gl.uniform2f(displayMaterial.uniforms.texelSize, 1 / gl.drawingBufferWidth, 1 / gl.drawingBufferHeight);
    gl.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0));
    blit(null, false);
  }

  function resizeCanvas() {
    var w = scaleByPixelRatio(canvas.clientWidth);
    var h = scaleByPixelRatio(canvas.clientHeight);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      return true;
    }
    return false;
  }

  function wrap(value, min, max) {
    var range = max - min;
    return range === 0 ? min : ((value - min) % range) + min;
  }

  // Update display keywords
  var displayKeywords = [];
  if (config.SHADING) displayKeywords.push("SHADING");
  displayMaterial.setKeywords(displayKeywords);

  initFramebuffers();

  // Event listeners
  function updatePointerDown(pointer, id, posX, posY) {
    pointer.id = id;
    pointer.down = true;
    pointer.moved = false;
    pointer.texcoordX = posX / canvas.width;
    pointer.texcoordY = 1 - posY / canvas.height;
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.deltaX = 0;
    pointer.deltaY = 0;
    pointer.color = generateColor();
  }

  function updatePointerMove(pointer, posX, posY) {
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.texcoordX = posX / canvas.width;
    pointer.texcoordY = 1 - posY / canvas.height;
    pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX);
    pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY);
    pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
  }

  window.addEventListener("mousedown", function (e) {
    var p = pointers[0];
    updatePointerDown(p, -1, scaleByPixelRatio(e.clientX), scaleByPixelRatio(e.clientY));
    clickSplat(p);
  });

  window.addEventListener("mousemove", function (e) {
    updatePointerMove(pointers[0], scaleByPixelRatio(e.clientX), scaleByPixelRatio(e.clientY));
  }, { passive: true });

  window.addEventListener("touchstart", function (e) {
    var touches = e.targetTouches;
    for (var i = 0; i < touches.length; i++) {
      updatePointerDown(pointers[0], touches[i].identifier, scaleByPixelRatio(touches[i].clientX), scaleByPixelRatio(touches[i].clientY));
    }
  }, { passive: true });

  window.addEventListener("touchmove", function (e) {
    var touches = e.targetTouches;
    for (var i = 0; i < touches.length; i++) {
      updatePointerMove(pointers[0], scaleByPixelRatio(touches[i].clientX), scaleByPixelRatio(touches[i].clientY));
    }
  }, { passive: true });

  window.addEventListener("touchend", function () { pointers[0].down = false; });

  // Animation loop
  function updateFrame() {
    var now = Date.now();
    var dt = Math.min((now - lastUpdateTime) / 1000, 0.016666);
    lastUpdateTime = now;

    colorUpdateTimer += dt * config.COLOR_UPDATE_SPEED;
    if (colorUpdateTimer >= 1) {
      colorUpdateTimer = wrap(colorUpdateTimer, 0, 1);
      pointers[0].color = generateColor();
    }

    for (var i = 0; i < pointers.length; i++) {
      if (pointers[i].moved) { pointers[i].moved = false; splatPointer(pointers[i]); }
    }

    if (resizeCanvas()) initFramebuffers();
    step(dt);
    render();
    animationId = requestAnimationFrame(updateFrame);
  }

  updateFrame();
})();
