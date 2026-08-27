// Live2D 宠物入口(esbuild 打包成 assets/pet-live2d.js, 供 pet.html 加载)
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
window.PIXI = PIXI;

window.startPetLive2D = function (canvas, modelUrl) {
  return new Promise((resolve) => {
    try {
      const app = new PIXI.Application({
        view: canvas, backgroundAlpha: 0, width: canvas.width, height: canvas.height,
        antialias: false, powerPreference: 'low-power', autoDensity: true,
      });
      // 性能: 限制帧率(宠物无需 60fps), 大幅降低 GPU/CPU 占用
      app.ticker.maxFPS = 24;
      Live2DModel.from(modelUrl, { autoInteract: false }).then((m) => {
        const s = Math.min(canvas.width / m.width, canvas.height / m.height);
        m.scale.set(s);
        m.anchor.set(0.5, 0.5);
        m.x = canvas.width / 2;
        m.y = canvas.height / 2;
        app.stage.addChild(m);
        // 播放一次打招呼动作, 之后自动 Idle(眨眼/呼吸)
        try { m.motion('Tap'); } catch (e) {}
        window.__petLive2D = { app, model: m };
        // 暴露暂停/恢复接口: 失去焦点时暂停渲染, 悬停/点按时恢复(省电省资源)
        window.setPetPaused = (p) => { try { p ? app.ticker.stop() : app.ticker.start(); } catch (e) {} };
        resolve({ ok: true });
      }).catch((e) => { console.error('[live2d] load fail', e); resolve({ ok: false, error: String(e) }); });
    } catch (e) {
      console.error('[live2d] init fail', e);
      resolve({ ok: false, error: String(e) });
    }
  });
};
