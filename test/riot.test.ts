import { JSDOM } from "jsdom";
import { ImportMock } from "ts-mock-imports";
import browserFake from "webextensions-api-fake";

import { html, expect, browserTypes, sendMessage } from "./common";
import * as utils from "~/utils";

import * as riot from "~/riot/lib";

browserTypes.map(browserType => {
  describe(`Riot Script ${browserType}`, () => {
    it("#listener", async function() {
      const browser = browserFake();
      riot.listener(browser);

      expect(browser.runtime.onMessage.addListener).to.have.been.calledOnce;

      global.window.location.hash = "foo";
      const tab = await browser.tabs._create({});
      browser.tabs.getCurrent.returns(tab);
      await sendMessage(browser, {
        type: "activeTabs",
      });

      expect(browser.runtime.sendMessage).to.have.been.calledOnceWithExactly({
        type: "activeTab",
        tabId: tab.id,
        hash: "#foo",
      });
    });

    it("#sanitize", function() {
      // eslint-disable-next-line no-restricted-globals
      global.browser = global.chrome = (browserFake() as unknown) as typeof browser;
      riot.sanitize();

      expect(Object.keys(global.browser)).to.have.length(4);
      expect(global.chrome).to.be.null;
    });

    it("#run", function() {
      const dom = new JSDOM(html);
      global.window = dom.window as Window & typeof globalThis;
      global.document = dom.window.document;
      const injectScriptStub = ImportMock.mockFunction(utils, "injectScript");
      riot.run();

      expect(global.window.vector_indexeddb_worker_script).to.be.ok;
      expect(injectScriptStub).to.have.been.calledWith(
        "bundles/webext/vendor.js"
      );
      expect(injectScriptStub).to.have.been.calledWith(
        "bundles/webext/bundle.js"
      );

      injectScriptStub.restore();
    });

    it("#initialize", async function() {
      const injectScriptStub = ImportMock.mockFunction(utils, "injectScript");
      injectScriptStub.callsFake(() => {
        // eslint-disable-next-line no-restricted-globals
        global.browser = (browserFake() as unknown) as typeof browser;
      });
      const sanitizeStub = ImportMock.mockFunction(riot, "sanitize");
      const listenerStub = ImportMock.mockFunction(riot, "listener");
      const runStub = ImportMock.mockFunction(riot, "run");
      if (browserType === "firefox") {
        // eslint-disable-next-line no-restricted-globals
        global.browser = (browserFake() as unknown) as typeof browser;
      }

      await riot.initialize();

      if (browserType !== "firefox") {
        expect(injectScriptStub).to.have.been.calledOnce;
      }
      expect(sanitizeStub).to.have.been.calledOnce;
      expect(listenerStub).to.have.been.calledOnce;
      expect(runStub).to.have.been.calledOnce;

      injectScriptStub.restore();
      sanitizeStub.restore();
      listenerStub.restore();
      runStub.restore();
    });
  });
});

it("should initialize", async function() {
  const initializeStub = ImportMock.mockFunction(riot, "initialize");
  await import("~/riot");
  expect(initializeStub).to.have.been.calledOnce;
  initializeStub.restore();
});
