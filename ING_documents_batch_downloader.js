// ==UserScript==
// @name         ING Postbox Batch Downloader
// @version      1.0
// @description  App to batch download documents from the ING Post-Box. Additionally it allows renaming of documents by date, document type, and subject.
// @function1    The app filters the visible Post-Box entries by date and downloads the matching documents.
// @function2    The documents can be automatically renamed - the available variables for renaming are date, document type, subject, and extracted tokens.
// @namespace    https://github.com/Erzmaster/Unofficial-ING-Documents-Batch-Downloader/
// @downloadURL  https://raw.githubusercontent.com/Erzmaster/Unofficial-ING-Documents-Batch-Downloader/refs/heads/main/ING_document_batch_downloader.js
// @match        https://banking.ing.de/app/postbox*
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  "use strict";

  var DEFAULT_TEMPLATE = "{date}_{doctype}_{subject_complete}";
  var DEFAULT_DELAY_MS = 800;
  var SLOW_DELAY_MS = 1200;
  var FAST_DELAY_MS = 400;
  var DEFAULT_DATE_FORMAT = "YYYYMMDD";
  var DEFAULT_USE_CUSTOM_NAMES = true;
  var DEFAULT_MARK_READ = true;
  var DEFAULT_SLOW_MODE = true;
  var LANG_KEY = "pb_lang";
  var stopRequested = false;
  var currentLang = "de";

  var STRINGS = {
    de: {
      title: "ING Post-Box Batch Downloader",
      fromLabel: "Von (Datum)",
      toLabel: "Bis (Datum)",
      fromPlaceholder: "Anfang oder 01.01.2023",
      toPlaceholder: "Heute oder 01.01.2025",
      markRead: "Als gelesen markieren",
      customNames: "Dateinamen umbenennen",
      filenameLabel: "Dateinamen-Template",
      filenameTokens: "Tokens: {date}, {doctype}, {subject_complete}, {subject_text}, {isin}, {iban}, {ordernumber}, {account_number}, {index}",
      dateFormatLabel: "Datumsformat",
      dateFormatTokens: "Tokens: YYYY, YY, MM, DD",
      slowMode: "Slow Mode",
      resetFilename: "Dateinamen zuruecksetzen",
      resetDate: "Datumsformat zuruecksetzen",
      resetAll: "Alles auf Standard",
      start: "Start",
      stop: "Stop",
      ready: "Bereit.",
      close: "×",
      langLabel: "Sprache",
      statusFilter: "Filter: {from} bis {to} (lade.)",
      statusStopRequested: "Stop angefordert.",
      statusInvalidDate: "Ungueltiges Datum bei \"{label}\": {value}",
      statusInvalidRange: "Ungueltiger Datumsbereich ({from} > {to}).",
      statusNoRange: "Keine Eintraege im Datumsbereich.",
      statusRunDone: "Durchlauf abgeschlossen.",
      statusAborted: "Abgebrochen.",
      statusRunning: "Laufend..."
    },
    en: {
      title: "ING Post-Box Batch",
      fromLabel: "From (date)",
      toLabel: "To (date)",
      fromPlaceholder: "Start or 01.01.2023",
      toPlaceholder: "Today or 01.01.2025",
      markRead: "Mark as read",
      customNames: "Rename file names",
      filenameLabel: "Filename template",
      filenameTokens: "Tokens: {date}, {doctype}, {subject_complete}, {subject_text}, {isin}, {iban}, {ordernumber}, {account_number}, {index}",
      dateFormatLabel: "Date format",
      dateFormatTokens: "Tokens: YYYY, YY, MM, DD",
      slowMode: "Slow mode",
      resetFilename: "Reset filename",
      resetDate: "Reset date format",
      resetAll: "Reset all",
      start: "Start",
      stop: "Stop",
      ready: "Ready.",
      close: "×",
      langLabel: "Language",
      statusFilter: "Filter: {from} to {to} (loading.)",
      statusStopRequested: "Stop requested.",
      statusInvalidDate: "Invalid date in \"{label}\": {value}",
      statusInvalidRange: "Invalid date range ({from} > {to}).",
      statusNoRange: "No entries in date range.",
      statusRunDone: "Run finished.",
      statusAborted: "Aborted.",
      statusRunning: "Running..."
    }
  };

  function fmt(template, ctx) {
    return template.replace(/\{(\w+)\}/g, function (match, key) {
      if (ctx && ctx[key] !== undefined) {
        return ctx[key];
      }
      return match;
    });
  }

  function tr(key, ctx) {
    var dict = STRINGS[currentLang] || STRINGS.en;
    var text = dict[key] || STRINGS.en[key] || key;
    return fmt(text, ctx);
  }

  function detectPreferredLang() {
    var langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]).filter(Boolean);
    var primary = (langs[0] || "").toLowerCase();
    return primary.indexOf("de") === 0 ? "de" : "en";
  }

  function loadLang() {
    var stored = GM_getValue(LANG_KEY, "");
    if (stored === "de" || stored === "en") {
      return stored;
    }
    return detectPreferredLang();
  }

  function setLang(value) {
    currentLang = value === "de" ? "de" : "en";
    GM_setValue(LANG_KEY, currentLang);
  }

  function getTemplate() {
    return GM_getValue("pb_template", DEFAULT_TEMPLATE);
  }

  function setTemplate(value) {
    GM_setValue("pb_template", value);
  }

  function getDelayMs() {
    var slowMode = GM_getValue("pb_slow_mode", DEFAULT_SLOW_MODE);
    return slowMode ? SLOW_DELAY_MS : FAST_DELAY_MS;
  }

  function setDelayMs(value) {
    GM_setValue("pb_delay_ms", value);
  }

  function getUseCustomNames() {
    return GM_getValue("pb_use_custom_names", DEFAULT_USE_CUSTOM_NAMES);
  }

  function setUseCustomNames(value) {
    GM_setValue("pb_use_custom_names", value);
  }

  function getSlowMode() {
    return GM_getValue("pb_slow_mode", DEFAULT_SLOW_MODE);
  }

  function setSlowMode(value) {
    GM_setValue("pb_slow_mode", value);
  }

  function getDateFormat() {
    return GM_getValue("pb_date_format", DEFAULT_DATE_FORMAT);
  }

  function setDateFormat(value) {
    GM_setValue("pb_date_format", value);
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function normalizeText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function safeFilename(name) {
    return name
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatDateIso(dateText) {
    // Expects DD.MM.YYYY
    var match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateText);
    if (!match) {
      return "";
    }
    return match[3] + "-" + match[2] + "-" + match[1];
  }

  function formatDate(dateText, format) {
    // Expects DD.MM.YYYY and formats with YYYY, YY, MM, DD
    var match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateText);
    if (!match) {
      return "";
    }
    var parts = {
      YYYY: match[3],
      YY: match[3].slice(-2),
      MM: match[2],
      DD: match[1]
    };
    return format.replace(/YYYY|YY|MM|DD/g, function (token) {
      return parts[token] || token;
    });
  }

  function parseDateInput(value, label, isFrom) {
    var raw = (value || "").trim();
    var v = raw.toLowerCase();
    var defaultFrom = currentLang === "de" ? "Anfang" : "Start";
    var defaultTo = currentLang === "de" ? "Heute" : "Today";
    if (!v || v === "anfang" || v === "start") {
      return { date: null, label: defaultFrom };
    }
    if (v === "heute" || v === "today") {
      var d = new Date();
      d.setHours(0, 0, 0, 0);
      return { date: d, label: defaultTo };
    }
    var match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw);
    if (!match) {
      return { date: null, label: raw, invalid: true, inputLabel: label };
    }
    var dateObj = new Date(parseInt(match[3], 10), parseInt(match[2], 10) - 1, parseInt(match[1], 10));
    dateObj.setHours(0, 0, 0, 0);
    return { date: dateObj, label: raw, invalid: false };
  }

  function parseEntryDate(dateText) {
    var match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateText);
    if (!match) {
      return null;
    }
    var dateObj = new Date(parseInt(match[3], 10), parseInt(match[2], 10) - 1, parseInt(match[1], 10));
    dateObj.setHours(0, 0, 0, 0);
    return dateObj;
  }

  function filterRowsByDate(rows, fromValue, toValue, statusEl) {
    var fromRes = parseDateInput(fromValue, tr("fromLabel"), true);
    var toRes = parseDateInput(toValue, tr("toLabel"), false);
    if (fromRes.invalid) {
      statusEl.textContent = tr("statusInvalidDate", { label: fromRes.inputLabel, value: fromValue });
      return null;
    }
    if (toRes.invalid) {
      statusEl.textContent = tr("statusInvalidDate", { label: toRes.inputLabel, value: toValue });
      return null;
    }
    var lower = fromRes.date;
    var upper = toRes.date;
    if (lower && upper && lower > upper) {
      statusEl.textContent = tr("statusInvalidRange", { from: fromRes.label, to: toRes.label });
      return null;
    }
    statusEl.textContent = tr("statusFilter", { from: fromRes.label, to: toRes.label });
    var filtered = rows.filter(function (row) {
      var dateEl = row.querySelector(".postbox-grid-right");
      var dateText = normalizeText(dateEl ? dateEl.textContent : "");
      var entryDate = parseEntryDate(dateText);
      if (!entryDate) {
        return false;
      }
      if (lower && entryDate < lower) {
        return false;
      }
      if (upper && entryDate > upper) {
        return false;
      }
      return true;
    });
    if (!filtered.length) {
      statusEl.textContent = tr("statusNoRange");
    }
    return filtered;
  }

  function extractTokens(subjectComplete) {
    var tokens = {
      isin: "",
      iban: "",
      ordernumber: "",
      account_number: ""
    };

    var isinMatch = subjectComplete.match(/\b[A-Z]{2}[A-Z0-9]{10}\b/);
    if (isinMatch) {
      tokens.isin = isinMatch[0];
    }

    var ibanMatch = subjectComplete.match(/\bDE\d{20}\b/);
    if (ibanMatch) {
      tokens.iban = ibanMatch[0];
    }

    var orderMatch = subjectComplete.match(/\bOrdernummer\s*[:#]?\s*([A-Z0-9\-\/]+)\b/);
    if (orderMatch) {
      tokens.ordernumber = orderMatch[1];
    }

    var accountMatch = subjectComplete.match(/\bExtra-Konto\s+(\d{10})\b/);
    if (accountMatch) {
      tokens.account_number = accountMatch[1];
    }

    return tokens;
  }

  function buildSubjectText(subjectComplete, tokens) {
    var text = subjectComplete;

    if (tokens.ordernumber) {
      text = text.replace(/\bOrdernummer\s*[:#]?\s*[A-Z0-9\-\/]+\b/, "");
    }
    if (tokens.account_number) {
      text = text.replace(/\bExtra-Konto\s+\d{10}\b/, "");
    }
    if (tokens.iban) {
      text = text.replace(tokens.iban, "");
    }
    if (tokens.isin) {
      text = text.replace(tokens.isin, "");
    }

    text = text.replace(/\s+/g, " ");
    text = text.replace(/^[\s\/|\-]+|[\s\/|\-]+$/g, "");
    return normalizeText(text);
  }

  function getRowDownloadLink(row) {
    var links = Array.prototype.slice.call(row.querySelectorAll("a[href]"));
    for (var i = 0; i < links.length; i += 1) {
      if (normalizeText(links[i].textContent) === "Download") {
        return links[i];
      }
    }
    return null;
  }

  function parseRow(row, index, dateFormat) {
    var doctypeEl = row.querySelector(".postbox-grid-left > span:not(.postbox-indicator)");
    var subjectEl = row.querySelector(".postbox-grid-description");
    var dateEl = row.querySelector(".postbox-grid-right");
    var linkEl = getRowDownloadLink(row);

    var doctype = normalizeText(doctypeEl ? doctypeEl.textContent : "");
    var subjectComplete = normalizeText(subjectEl ? subjectEl.textContent : "");
    var dateText = normalizeText(dateEl ? dateEl.textContent : "");

    var tokens = extractTokens(subjectComplete);
    var subjectText = buildSubjectText(subjectComplete, tokens);

    return {
      row: row,
      index: index,
      doctype: doctype,
      subject_complete: subjectComplete,
      subject_text: subjectText,
      date: formatDate(dateText, dateFormat),
      date_iso: formatDateIso(dateText),
      isin: tokens.isin,
      iban: tokens.iban,
      ordernumber: tokens.ordernumber,
      account_number: tokens.account_number,
      download_url: linkEl ? linkEl.href : "",
      link_el: linkEl
    };
  }

  function replaceTokens(template, data) {
    return template.replace(/\{([a-z0-9_]+)\}/gi, function (match, key) {
      var value = data[key];
      if (value === undefined || value === null) {
        return "";
      }
      return String(value);
    });
  }

  function buildFilename(template, data) {
    var raw = replaceTokens(template, data);
    var base = safeFilename(raw);
    if (!base) {
      return "";
    }
    base = base.replace(/\.[A-Za-z0-9]+$/, "");
    return base + ".pdf";
  }

  function ensureRowCheckbox(row) {
    if (row.querySelector(".vm-pb-check")) {
      return;
    }
    var cell = row.querySelector(".postbox-grid-left");
    if (!cell) {
      return;
    }
    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "vm-pb-check";
    checkbox.checked = true;
    cell.insertBefore(checkbox, cell.firstChild);
  }

  function collectRows() {
    var rows = Array.prototype.slice.call(
      document.querySelectorAll(".ibbr-table-row.postbox-message, .ibbr-table-row.postbox-unread")
    );
    rows.forEach(ensureRowCheckbox);
    return rows;
  }

  function getSelectedRows() {
    return collectRows().filter(function (row) {
      var checkbox = row.querySelector(".vm-pb-check");
      return checkbox && checkbox.checked;
    });
  }

  async function downloadOriginal(rows, delayMs, markRead) {
    for (var i = 0; i < rows.length; i += 1) {
      if (stopRequested) {
        break;
      }
      var data = parseRow(rows[i], i + 1, getDateFormat());
      if (!data.link_el) {
        continue;
      }
      if (markRead) {
        try {
          rows[i].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        } catch (err) {
          // Ignore
        }
      }
      data.link_el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await sleep(delayMs);
    }
  }

  async function downloadCustom(rows, delayMs, markRead, template) {
    for (var i = 0; i < rows.length; i += 1) {
      if (stopRequested) {
        break;
      }
      var data = parseRow(rows[i], i + 1, getDateFormat());
      if (!data.download_url) {
        continue;
      }
      if (markRead) {
        try {
          rows[i].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        } catch (err) {
          // Ignore
        }
      }
      var name = buildFilename(template, data);
      if (!name) {
        name = "postbox_download_" + data.index + ".pdf";
      }
      GM_download({
        url: data.download_url,
        name: name
      });
      await sleep(delayMs);
    }
  }

  function buildPanel() {
    if (document.getElementById("vm-pb-panel")) {
      return;
    }

    currentLang = loadLang();
    var panel = document.createElement("div");
    panel.id = "vm-pb-panel";
    panel.style.cssText =
      "position: fixed; z-index: 999999; left: 12px; bottom: 12px;" +
      "background: rgba(20,20,20,.92); color: #fff; font: 12px system-ui, sans-serif;" +
      "border-radius: 12px; padding: 12px; width: 320px; box-shadow: 0 6px 20px rgba(0,0,0,.45);";
    panel.innerHTML =
      "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;'>" +
      "  <strong id='vm-pb-title' style='white-space:pre-line;line-height:1.2;'></strong>" +
      "  <div style='display:flex;align-items:center;gap:6px;'>" +
      "    <label for='vm-pb-lang' style='color:#9ca3af;' id='vm-pb-lang-label'></label>" +
      "    <select id='vm-pb-lang' style='background:#0b0b0b;color:#fff;border:1px solid #333;border-radius:6px;padding:2px 6px;'>" +
      "      <option value='de'>Deutsch</option>" +
      "      <option value='en'>English</option>" +
      "    </select>" +
      "    <button id='vm-pb-close' style='background:none;border:none;color:#aaa;font-size:16px;cursor:pointer;'></button>" +
      "  </div>" +
      "</div>" +
      "<div style='display:grid;grid-template-columns:1fr 1fr;gap:8px;'>" +
      "  <label id='vm-pb-from-label'></label>" +
      "  <label id='vm-pb-to-label'></label>" +
      "</div>" +
      "<div style='display:grid;grid-template-columns:1fr 1fr;gap:8px;'>" +
      "  <input id='vm-pb-from' type='text' style='width:100%;padding:6px;border-radius:8px;border:1px solid #333;background:#0b0b0b;color:#fff;'>" +
      "  <input id='vm-pb-to' type='text' style='width:100%;padding:6px;border-radius:8px;border:1px solid #333;background:#0b0b0b;color:#fff;'>" +
      "</div>" +
      "<label style='display:flex;gap:6px;align-items:center;margin-top:8px;'>" +
      "  <input id='vm-pb-custom-names' type='checkbox'> <span id='vm-pb-custom-names-label'></span>" +
      "</label>" +
      "<label style='display:flex;gap:6px;align-items:center;margin-top:4px;'>" +
      "  <input id='vm-pb-slow-mode' type='checkbox'> <span id='vm-pb-slow-mode-label'></span>" +
      "</label>" +
      "<label style='display:flex;gap:6px;align-items:center;margin-top:4px;'>" +
      "  <input id='vm-pb-mark-read' type='checkbox'> <span id='vm-pb-mark-read-label'></span>" +
      "</label>" +
      "<label style='display:flex;flex-direction:column;gap:4px;margin-top:8px;' id='vm-pb-template-label'></label>" +
      "<input id='vm-pb-template' type='text' style='width:100%;padding:6px;border-radius:8px;border:1px solid #333;background:#0b0b0b;color:#fff;'>" +
      "<label style='display:flex;flex-direction:column;gap:4px;margin-top:6px;' id='vm-pb-date-format-label'></label>" +
      "<input id='vm-pb-date-format' type='text' style='width:100%;padding:6px;border-radius:8px;border:1px solid #333;background:#0b0b0b;color:#fff;'>" +
      "<div style='display:flex;gap:8px;margin-top:6px;'>" +
      "  <button id='vm-pb-reset-template' style='flex:1;padding:6px;border-radius:8px;border:1px solid #444;background:#111;color:#eee;cursor:pointer;'></button>" +
      "  <button id='vm-pb-reset-date' style='flex:1;padding:6px;border-radius:8px;border:1px solid #444;background:#111;color:#eee;cursor:pointer;'></button>" +
      "</div>" +
      "<button id='vm-pb-reset-all' style='margin-top:6px;width:100%;padding:6px;border-radius:8px;border:1px solid #555;background:#1a1a1a;color:#fff;cursor:pointer;'></button>" +
      "<div id='vm-pb-status' style='margin:8px 0; min-height:18px; color:#9fdcff;'></div>" +
      "<div style='display:flex; gap:8px;'>" +
      "  <button id='vm-pb-start-btn' style='flex:1;padding:8px;border-radius:8px;border:none;background:#0ea5e9;color:#fff;cursor:pointer;'></button>" +
      "  <button id='vm-pb-stop-btn' style='flex:1;padding:8px;border-radius:8px;border:1px solid #666;background:#222;color:#eee;cursor:pointer;'></button>" +
      "</div>" +
      "";

    document.body.appendChild(panel);

    var templateInput = panel.querySelector("#vm-pb-template");
    var dateFormatInput = panel.querySelector("#vm-pb-date-format");
    var fromInput = panel.querySelector("#vm-pb-from");
    var toInput = panel.querySelector("#vm-pb-to");
    var useCustomNamesInput = panel.querySelector("#vm-pb-custom-names");
    var markReadInput = panel.querySelector("#vm-pb-mark-read");
    var slowModeInput = panel.querySelector("#vm-pb-slow-mode");
    var statusEl = panel.querySelector("#vm-pb-status");
    var resetTemplateBtn = panel.querySelector("#vm-pb-reset-template");
    var resetDateBtn = panel.querySelector("#vm-pb-reset-date");
    var resetAllBtn = panel.querySelector("#vm-pb-reset-all");
    var startBtn = panel.querySelector("#vm-pb-start-btn");
    var stopBtn = panel.querySelector("#vm-pb-stop-btn");
    var langSelect = panel.querySelector("#vm-pb-lang");
    var titleEl = panel.querySelector("#vm-pb-title");
    var langLabelEl = panel.querySelector("#vm-pb-lang-label");
    var fromLabelEl = panel.querySelector("#vm-pb-from-label");
    var toLabelEl = panel.querySelector("#vm-pb-to-label");
    var customNamesLabelEl = panel.querySelector("#vm-pb-custom-names-label");
    var markReadLabelEl = panel.querySelector("#vm-pb-mark-read-label");
    var templateLabelEl = panel.querySelector("#vm-pb-template-label");
    var dateFormatLabelEl = panel.querySelector("#vm-pb-date-format-label");
    var slowModeLabelEl = panel.querySelector("#vm-pb-slow-mode-label");

    templateInput.value = getTemplate();
    dateFormatInput.value = getDateFormat();
    useCustomNamesInput.checked = !!getUseCustomNames();
    markReadInput.checked = DEFAULT_MARK_READ;
    slowModeInput.checked = !!getSlowMode();
    langSelect.value = currentLang;

    function applyLabels() {
      var title = tr("title");
      var titleParts = title.split(" ");
      if (titleParts.length > 1) {
        var last = titleParts.pop();
        title = titleParts.join(" ") + "\n" + last;
      }
      titleEl.textContent = title;
      langLabelEl.textContent = tr("langLabel");
      panel.querySelector("#vm-pb-close").textContent = tr("close");
      fromLabelEl.textContent = tr("fromLabel");
      toLabelEl.textContent = tr("toLabel");
      fromInput.placeholder = tr("fromPlaceholder");
      toInput.placeholder = tr("toPlaceholder");
      var defaultFrom = currentLang === "de" ? "Anfang" : "Start";
      var defaultTo = currentLang === "de" ? "Heute" : "Today";
      if (!fromInput.value || fromInput.value === "Anfang" || fromInput.value === "Start") {
        fromInput.value = defaultFrom;
      }
      if (!toInput.value || toInput.value === "Heute" || toInput.value === "Today") {
        toInput.value = defaultTo;
      }
      customNamesLabelEl.textContent = tr("customNames");
      markReadLabelEl.textContent = tr("markRead");
      templateLabelEl.innerHTML = tr("filenameLabel") + " <span style='font-size:11px;color:#9ca3af;'>" + tr("filenameTokens") + "</span>";
      dateFormatLabelEl.innerHTML = tr("dateFormatLabel") + " <span style='font-size:11px;color:#9ca3af;'>" + tr("dateFormatTokens") + "</span>";
      slowModeLabelEl.textContent = tr("slowMode");
      resetTemplateBtn.textContent = tr("resetFilename");
      resetDateBtn.textContent = tr("resetDate");
      resetAllBtn.textContent = tr("resetAll");
      startBtn.textContent = tr("start");
      stopBtn.textContent = tr("stop");
      statusEl.textContent = tr("ready");
    }

    applyLabels();

    templateInput.addEventListener("change", function () {
      setTemplate(templateInput.value);
    });

    dateFormatInput.addEventListener("change", function () {
      setDateFormat(dateFormatInput.value);
    });

    useCustomNamesInput.addEventListener("change", function () {
      setUseCustomNames(useCustomNamesInput.checked);
    });

    slowModeInput.addEventListener("change", function () {
      setSlowMode(slowModeInput.checked);
    });

    panel.querySelector("#vm-pb-close").addEventListener("click", function () {
      panel.remove();
    });

    langSelect.addEventListener("change", function () {
      setLang(langSelect.value);
      applyLabels();
    });

    resetTemplateBtn.addEventListener("click", function () {
      templateInput.value = DEFAULT_TEMPLATE;
      setTemplate(DEFAULT_TEMPLATE);
    });

    resetDateBtn.addEventListener("click", function () {
      dateFormatInput.value = DEFAULT_DATE_FORMAT;
      setDateFormat(DEFAULT_DATE_FORMAT);
    });

    resetAllBtn.addEventListener("click", function () {
      templateInput.value = DEFAULT_TEMPLATE;
      dateFormatInput.value = DEFAULT_DATE_FORMAT;
      useCustomNamesInput.checked = DEFAULT_USE_CUSTOM_NAMES;
      markReadInput.checked = DEFAULT_MARK_READ;
      slowModeInput.checked = DEFAULT_SLOW_MODE;
      setTemplate(DEFAULT_TEMPLATE);
      setDateFormat(DEFAULT_DATE_FORMAT);
      setUseCustomNames(DEFAULT_USE_CUSTOM_NAMES);
      setSlowMode(DEFAULT_SLOW_MODE);
    });

    startBtn.addEventListener("click", async function () {
      stopRequested = false;
      statusEl.textContent = tr("statusRunning");
      var rows = getSelectedRows();
      var filteredRows = filterRowsByDate(rows, fromInput.value, toInput.value, statusEl);
      if (!filteredRows) {
        return;
      }
      if (!filteredRows.length) {
        return;
      }
      if (useCustomNamesInput.checked) {
        await downloadCustom(filteredRows, getDelayMs(), markReadInput.checked, getTemplate());
      } else {
        await downloadOriginal(filteredRows, getDelayMs(), markReadInput.checked);
      }
      statusEl.textContent = stopRequested ? tr("statusAborted") : tr("statusRunDone");
    });

    stopBtn.addEventListener("click", function () {
      stopRequested = true;
      statusEl.textContent = tr("statusStopRequested");
      templateInput.value = DEFAULT_TEMPLATE;
      dateFormatInput.value = DEFAULT_DATE_FORMAT;
      useCustomNamesInput.checked = DEFAULT_USE_CUSTOM_NAMES;
      markReadInput.checked = DEFAULT_MARK_READ;
      slowModeInput.checked = DEFAULT_SLOW_MODE;
      fromInput.value = "";
      toInput.value = "";
      setTemplate(DEFAULT_TEMPLATE);
      setDateFormat(DEFAULT_DATE_FORMAT);
      setUseCustomNames(DEFAULT_USE_CUSTOM_NAMES);
      setSlowMode(DEFAULT_SLOW_MODE);
    });
  }

  function init() {
    buildPanel();
    collectRows();
  }

  init();
})();
