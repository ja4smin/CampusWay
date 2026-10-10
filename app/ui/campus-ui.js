/* ==========================================================================
   CampusWay — campus map UI layer
   --------------------------------------------------------------------------
   Pure presentation helpers for index.html. Routing, search and journey logic
   stay in the main page script; this file only adds:
     • toasts (non-blocking replacement for alert())
     • the collapsible map key
     • keyboard navigation + ARIA for the search suggestion lists
     • a short hint while Food / Shops are highlighted on the map
     • the "Indoor navigation" entry for people already inside a building
   It relies on globals from the main script: t, lang, currentProfile, ICONS,
   ICON_KEYS, favourites, buildingMarkers, fitCampusControl, pickLang.
   ========================================================================== */
(function(){
  'use strict';

  const $ = id => document.getElementById(id);

  function readPref(key){
    try{ return localStorage.getItem(key); }catch(error){ return null; }
  }
  function writePref(key, value){
    try{ localStorage.setItem(key, value); }catch(error){ /* storage unavailable */ }
  }

  // ── Toasts ────────────────────────────────────────────────────────────
  function toast(message, {timeout = 6000} = {}){
    const region = $('toastRegion');
    if(!region || !message) return;

    const item = document.createElement('div');
    item.className = 'toast';

    const text = document.createElement('div');
    text.className = 'toast-text';
    text.textContent = String(message);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '✕';
    close.onclick = () => item.remove();

    item.append(text, close);
    region.appendChild(item);

    // Keep at most three messages on screen.
    while(region.children.length > 3) region.firstElementChild.remove();
    if(timeout) setTimeout(() => item.remove(), timeout);
  }

  // ── Map key ───────────────────────────────────────────────────────────
  function setupLegend(){
    const toggle = $('legendToggle');
    const legend = $('mapLegend');
    if(!toggle || !legend) return;

    const saved = readPref('campusway.legendOpen');
    const startOpen = window.innerWidth <= 768
  ? false
  : saved === null ? true : saved === 'true';

    const apply = openLegend => {
      legend.hidden = !openLegend;
      toggle.setAttribute('aria-expanded', String(openLegend));
    };
    apply(startOpen);

    toggle.addEventListener('click', () => {
      const openLegend = legend.hidden;
      apply(openLegend);
      writePref('campusway.legendOpen', String(openLegend));
    });
  }

  // ── Search suggestions: ARIA + keyboard ───────────────────────────────
  function setupSuggestionList(inputId, listId){
    const input = $(inputId);
    const list = $(listId);
    if(!input || !list) return;

    let activeIndex = -1;

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-expanded', 'false');
    list.setAttribute('role', 'listbox');

    const options = () => [...list.querySelectorAll('.suggestion-item:not([role="status"])')];
    const isOpen = () => list.style.display !== 'none' && list.children.length > 0;

    function setActive(index){
      const items = options();
      items.forEach(item => {
        item.classList.remove('is-active');
        item.setAttribute('aria-selected', 'false');
      });
      activeIndex = index;
      const item = items[index];
      if(item){
        item.classList.add('is-active');
        item.setAttribute('aria-selected', 'true');
        input.setAttribute('aria-activedescendant', item.id);
        item.scrollIntoView({block: 'nearest'});
      }else{
        input.removeAttribute('aria-activedescendant');
      }
    }

    // Keep roles/ids in sync whenever the main script re-renders the list.
    new MutationObserver(() => {
      options().forEach((item, index) => {
        item.setAttribute('role', 'option');
        if(!item.id) item.id = `${listId}-option-${index}-${Date.now().toString(36)}`;
      });
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');
      input.setAttribute('aria-expanded', String(isOpen()));
    }).observe(list, {childList: true, attributes: true, attributeFilter: ['style']});

    // Close the list when keyboard focus leaves the field (Tab), but not while
    // the pointer is pressing one of its options.
    let pointerInList = false;
    list.addEventListener('pointerdown', () => { pointerInList = true; });
    document.addEventListener('pointerup', () => { setTimeout(() => { pointerInList = false; }, 0); });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if(pointerInList) return;
        if(document.activeElement === input || list.contains(document.activeElement)) return;
        list.style.display = 'none';
      }, 150);
    });

    // Capture phase so Enter on a highlighted option wins over the page's own Enter handler.
    document.addEventListener('keydown', event => {
      if(event.target !== input) return;
      const items = options();

      if(event.key === 'ArrowDown' || event.key === 'ArrowUp'){
        if(!isOpen() || !items.length) return;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = activeIndex < 0
          ? (step > 0 ? 0 : items.length - 1)
          : (activeIndex + step + items.length) % items.length;
        setActive(next);
      }else if(event.key === 'Enter'){
        if(isOpen() && items[activeIndex]){
          event.preventDefault();
          event.stopImmediatePropagation();
          items[activeIndex].click();
        }
      }else if(event.key === 'Escape'){
        if(isOpen()){
          event.preventDefault();
          list.style.display = 'none';
          setActive(-1);
        }
      }
    }, true);
  }

  // ── Food / Shops highlight hint ───────────────────────────────────────
  let updateServiceStatus = () => {};

  function setupServiceStatus(){
    const status = $('serviceStatus');
    const grid = document.querySelector('.service-grid');
    if(!status || !grid) return;

    const update = updateServiceStatus = () => {
      const food = $('serviceFoodBtn')?.classList.contains('service-active');
      const shop = $('serviceShopBtn')?.classList.contains('service-active');
      document.querySelectorAll('.service-grid .a11y-btn').forEach(button => {
        button.setAttribute('aria-pressed', String(button.classList.contains('service-active')));
      });
      status.textContent = food ? (t.foodModeHint || '') : shop ? (t.shopModeHint || '') : '';
    };

    new MutationObserver(update).observe(grid, {subtree: true, attributes: true, attributeFilter: ['class']});
    update();
  }

  // ── Indoor navigation entry (already inside a building) ───────────────
  function renderIndoorBuildings(){
    const container = $('indoorBuildingButtons');
    if(!container || typeof INDOOR_NAVIGATION_BUILDINGS === 'undefined') return;
    container.innerHTML = '';
    Object.entries(INDOOR_NAVIGATION_BUILDINGS).forEach(([campusName, key]) => {
      const building = CAMPUS_DATA.buildings.find(b => b.name === campusName);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'building-item';
      const name = document.createElement('span');
      name.className = 'bname';
      name.textContent = building ? localizedBuildingName(building) : campusName;
      const go = document.createElement('span');
      go.className = 'go';
      go.setAttribute('aria-hidden', 'true');
      go.textContent = document.documentElement.dir === 'rtl' ? '←' : '→';
      button.append(name, go);
      button.onclick = () => openIndoorNavigation(key);
      container.appendChild(button);
    });
  }

  function setupIndoorEntry(){
    const toggle = $('indoorEntryToggle');
    const list = $('indoorBuildingList');
    if(!toggle || !list) return;
    toggle.addEventListener('click', () => {
      const opening = list.hidden;
      list.hidden = !opening;
      toggle.setAttribute('aria-expanded', String(opening));
      if(opening) list.querySelector('button')?.focus();
    });
    list.addEventListener('keydown', event => {
      if(event.key !== 'Escape') return;
      list.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    });
    renderIndoorBuildings();
  }

  function localizeMapControls(){
    [
      ['.leaflet-control-zoom-in', t.zoomIn || 'Zoom in'],
      ['.leaflet-control-zoom-out', t.zoomOut || 'Zoom out'],
      ['.leaflet-popup-close-button', t.closePopup || 'Close popup']
    ].forEach(([selector, label]) => {
      document.querySelectorAll(selector).forEach(element => {
        element.title = label;
        element.setAttribute('aria-label', label);
      });
    });
  }

  // ── Language-dependent refresh (called from pickLang) ─────────────────
  function refresh(){
    if(typeof buildingMarkers !== 'undefined'){
      Object.values(buildingMarkers).forEach(marker => {
        if(marker.getTooltip && marker.getTooltip() && marker.buildingData){
          const label = localizedBuildingName(marker.buildingData);
          marker.setTooltipContent(label);
          const element = marker.getElement?.();
          if(element){
            element.title = label;
            element.setAttribute('aria-label', label);
          }
        }
      });
    }
    if(typeof fitCampusControl !== 'undefined' && fitCampusControl.setLabel){
      fitCampusControl.setLabel(t.showCampus || 'Show whole campus');
    }
    if(typeof updateBuildingLabelVisibility === 'function') updateBuildingLabelVisibility();
    localizeMapControls();
    updateServiceStatus();
    renderIndoorBuildings();
  }

  function init(){
    setupLegend();
    setupSuggestionList('startInput', 'startSuggestions');
    setupSuggestionList('searchInput', 'searchSuggestions');
    setupServiceStatus();
    setupIndoorEntry();
    if(typeof map !== 'undefined' && map?.on){
      map.on('popupopen', localizeMapControls);
    }
  }

  window.CampusUI = {toast, refresh};

  // Loaded at the end of <body>, so the elements already exist.
  init();
})();
