// BySS: настройки профиля Firefox. Применяются при каждом запуске (главные ещё и закреплены политиками).

// своё расширение BySS (без подписи Mozilla — можно только в Firefox ESR)
user_pref("xpinstall.signatures.required", false);
// постоянный адрес страниц BySS — на него указывает домашняя страница
user_pref("extensions.webextensions.uuids", "{\"byss@byss.app\":\"a90f5681-e157-4e8e-8725-17a034929c49\"}");
// оформление окна в стиле BySS (chrome/userChrome.css)
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);

// без истории: посещённые сайты, поиски и формы не запоминаются (входы и куки — да)
user_pref("places.history.enabled", false);
user_pref("browser.formfill.enable", false);
user_pref("browser.urlbar.suggest.history", false);
user_pref("browser.urlbar.suggest.recentsearches", false);
user_pref("browser.download.manager.addToRecentDocs", false);

// без приветствий, опросов и рекламы Mozilla
user_pref("browser.aboutwelcome.enabled", false);
user_pref("trailhead.firstrun.didSeeAboutWelcome", true);
user_pref("browser.rights.3.shown", true);
user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("app.normandy.enabled", false);
user_pref("browser.newtabpage.activity-stream.showSponsored", false);
user_pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
user_pref("browser.urlbar.suggest.quicksuggest.sponsored", false);
user_pref("browser.urlbar.suggest.quicksuggest.nonsponsored", false);

// вид: без закладок и Firefox View, вкладки в заголовке окна
user_pref("browser.toolbars.bookmarks.visibility", "never");
user_pref("browser.tabs.firefox-view", false);
user_pref("browser.tabs.inTitlebar", 1);
user_pref("browser.compactmode.show", true);

// удобства
user_pref("general.autoScroll", true);
user_pref("browser.translations.automaticallyPopup", true);
user_pref("extensions.update.interval", 21600);
