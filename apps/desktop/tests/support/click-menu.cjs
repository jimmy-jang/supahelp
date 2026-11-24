const assert = require('node:assert/strict');

// Pointer input catches hidden menu items that DOM .click() would still activate.
module.exports = async function clickMenu(window, panel, action) {
  const evaluate = (code) =>
    window.webContents.executeJavaScript(code, true).catch((error) => {
      throw Error(`${code}: ${error.message}`);
    });
  const wait = async (expression) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw Error(`Menu condition timed out: ${expression}`);
  };
  const click = async (expression) => {
    const { x, y } = await evaluate(`(()=>{
      const button = ${expression};
      const rect = button.getBoundingClientRect();
      return {x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2)};
    })()`);
    window.webContents.sendInputEvent({
      type: 'mouseDown',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    window.webContents.sendInputEvent({
      type: 'mouseUp',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
  };
  await evaluate(
    `Promise.all(document.querySelector(${JSON.stringify(panel)}).getAnimations().map(a => a.finished))`,
  );
  await click(
    `document.querySelector(${JSON.stringify(panel + ' button[title="More"]')})`,
  );
  await wait(
    `!!document.querySelector(${JSON.stringify(panel + ' :popover-open')})`,
  );
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector(${JSON.stringify(panel + ' :popover-open')})).getPropertyValue('-webkit-app-region')`,
    ),
    'no-drag',
    'Document menus must opt out of the draggable window header',
  );
  await click(
    `[...document.querySelectorAll(${JSON.stringify(panel + ' :popover-open button')})].find(b => b.textContent.trim() === ${JSON.stringify(action)})`,
  );
  await wait(
    `!document.querySelector(${JSON.stringify(panel + ' :popover-open')})`,
  );
};
