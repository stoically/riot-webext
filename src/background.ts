import riotConfigBundled from "../riot-web/config.sample.json";
import { webRequestOnHeadersReceivedCallbackDetails } from "./types-browser.js";
import { Logger } from "./log";

declare global {
  interface Window {
    background: Background;
    vector_indexeddb_worker_script: string;
  }
}

type SsoResponseListener = (
  details: webRequestOnHeadersReceivedCallbackDetails
) => Promise<browser.webRequest.BlockingResponse>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Message = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MessageResponse = any;

export class Background extends Logger {
  public webappPath = "/riot/index.html";
  public manifest = browser.runtime.getManifest();
  public version = this.manifest.version;
  public browserType = this.manifest.applications?.gecko ? "firefox" : "chrome";
  public activeTabs: { tabId: number; hash: string }[] = [];

  constructor() {
    super();
    this.logger("constructor").debug("Browser:", this.browserType);

    browser.runtime.onInstalled.addListener(this.handleInstalled.bind(this));
    browser.runtime.onMessage.addListener(this.handleMessage.bind(this));
    browser.runtime.onUpdateAvailable.addListener(
      this.handleUpdateAvailable.bind(this)
    );
    browser.browserAction.onClicked.addListener(this.createTab.bind(this));

    browser.storage.local.set({ version: this.version });

    this.maybeUpdated();
  }

  async handleSsoLogin(
    url: string,
    responseUrl: string,
    tabId: number
  ): Promise<void> {
    const { debug } = this.logger("handleSsoLogin");
    debug(url, responseUrl);

    browser.webRequest.onHeadersReceived.addListener(
      this.createSsoResponseListener(tabId),
      { urls: [responseUrl] },
      ["responseHeaders"]
    );

    debug("redirecting tab", tabId, url);
    await browser.tabs.update(tabId, { url });
  }

  createSsoResponseListener(tabId: number): SsoResponseListener {
    let listenerTimeout: false | NodeJS.Timeout = false;
    const listener: SsoResponseListener = async (
      details: webRequestOnHeadersReceivedCallbackDetails
    ) => {
      const { debug } = this.logger("ssoResponseListener");
      debug("incoming", details.url);

      if (!listenerTimeout) {
        listenerTimeout = setTimeout(() => {
          // remove listener after an hour in case the sso flow is interrupted
          browser.webRequest.onHeadersReceived.removeListener(listener);
          debug("sso timed out");
        }, 60 * 60 * 1000);
        debug("registered 1h timeout");
      }

      const location = details.responseHeaders?.find(
        responseHeader => responseHeader.name.toLowerCase() === "location"
      );
      if (!location?.value) {
        debug("no location header");
        return {};
      }

      const url = new URL(location.value);
      debug("location header found", url.origin);
      if (!browser.runtime.getURL("/").startsWith(url.origin)) {
        debug("location does not point to the extension, ignoring");
        return {};
      }

      debug("location points to the extension, redirecting tab", tabId);
      browser.webRequest.onHeadersReceived.removeListener(listener);
      clearTimeout(listenerTimeout);
      await browser.tabs.update(tabId, { url: location.value });
      return {};
    };

    return listener;
  }

  async handleInstalled(details: {
    reason: browser.runtime.OnInstalledReason;
    temporary: boolean;
  }): Promise<browser.tabs.Tab | undefined> {
    const { debug } = this.logger("handleInstalled");
    debug("onInstalled", details);
    switch (details.reason) {
      case "install":
        debug("First install, opening Riot tab");
        return this.createTab();

      case "update":
        if (details.temporary) {
          return this.createTab();
        }
    }
  }

  async maybeUpdated(): Promise<void> {
    const { debug } = this.logger("maybeUpdated");
    const { update } = await browser.storage.local.get("update");
    if (!update) {
      return;
    }

    debug("Updated", update);
    try {
      const windows = await browser.windows.getAll();
      const windowIds = windows.map(window => window.id);

      await Promise.all(
        update.tabs.map((tab: any) => {
          debug("Reopening tab", tab);
          // TODO: legacy `if`, remove with next major version
          if (!tab.url) {
            let url = this.webappPath;
            if (tab.hash) {
              url += tab.hash;
            }
            tab.url = url;
            delete tab.hash;
          }

          if (this.browserType !== "firefox") {
            delete tab.cookieStoreId;
          }

          if (windowIds.includes(tab.windowId)) {
            return browser.tabs.create(tab);
          } else {
            const createData: { url: string; cookieStoreId?: string } = {
              url: tab.url
            };
            if (this.browserType === "firefox") {
              createData.cookieStoreId = tab.cookieStoreId;
            }
            return browser.windows.create(createData);
          }
        })
      );
    } catch (error) {
      debug("Reopening tabs after update failed", error);
      throw error;
    }

    await browser.storage.local.remove("update");
  }

  async handleMessage(
    message: Message,
    sender: browser.runtime.MessageSender
  ): Promise<MessageResponse> {
    const { debug } = this.logger("handleMessage");
    debug("Incoming message", message);

    switch (message.method) {
      case "version":
        return this.version;

      case "installUpdate":
        return this.installUpdate();

      case "activeTab":
        this.activeTabs.push({
          tabId: message.tabId,
          hash: message.hash
        });
        return;

      case "config":
        return this.getConfig();

      case "ssoLogin":
        if (!sender.tab?.id) {
          return;
        }
        return this.handleSsoLogin(
          message.url,
          message.responseUrl,
          sender.tab.id
        );
    }
  }

  handleUpdateAvailable(details: { version: string }): void {
    const { debug } = this.logger("handleUpdateAvailable");
    debug("Update available", details);
    this.version = details.version;
  }

  async createTab(): Promise<browser.tabs.Tab> {
    const { debug } = this.logger("createTab");
    debug("Creating riot tab");
    return browser.tabs.create({
      url: this.webappPath
    });
  }

  async installUpdate(): Promise<void> {
    const { debug } = this.logger("installUpdate");
    try {
      this.activeTabs = [];
      await browser.runtime.sendMessage({ method: "activeTabs" });

      // give tabs 500ms to respond
      // workaround for sendMessage not supporting multiple return messages
      await new Promise(resolve => setTimeout(resolve, 500));

      const tabs = await Promise.all(
        this.activeTabs.map(async ({ tabId, hash }) => {
          const tab = await browser.tabs.get(tabId);

          return {
            index: tab.index,
            pinned: tab.pinned,
            windowId: tab.windowId,
            hash,
            cookieStoreId:
              this.browserType === "firefox" ? tab.cookieStoreId : false
          };
        })
      );

      await browser.storage.local.set({
        update: {
          version: this.version,
          tabs
        }
      });

      this.activeTabs = [];
      browser.runtime.reload();
    } catch (error) {
      debug("updating failed", error.toString());
      throw error;
    }
  }

  async getConfig(): Promise<any> {
    const { riotConfigDefault } = await browser.storage.local.get([
      "riotConfigDefault"
    ]);

    return riotConfigDefault || riotConfigBundled;
  }
}

if (typeof window !== "undefined") {
  window.background = new Background();
}
