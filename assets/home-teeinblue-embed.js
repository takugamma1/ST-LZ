/**
 * Home Teeinblue Embed
 *
 * Fetches the full product page HTML and extracts the Teeinblue customizer
 * to display on the homepage. This approach bypasses Shopify's Sections
 * Rendering API limitations with app blocks.
 *
 * Strategy:
 * 1. Fetch full product page (NOT using ?section_id=)
 * 2. Parse with DOMParser
 * 3. Extract Teeinblue elements using selector cascade
 * 4. Inject into homepage container
 * 5. Re-execute scripts to initialize the app
 */
(() => {
  'use strict';

  const SELECTOR = '[data-home-teeinblue-container]';
  const EVENT_LOADED = 'home:teeinblue:loaded';
  const EVENT_ERROR = 'home:teeinblue:error';

  // Selectors for finding Teeinblue elements (in priority order)
  const TEEINBLUE_SELECTORS = [
    // Teeinblue-specific selectors (most likely)
    '[data-teeinblue]',
    '[data-tib-product]',
    '[data-tib-personalization]',
    '.teeinblue-personalization',
    '.teeinblue-customizer',
    '.tib-personalization',
    '.tib-customizer',
    '#teeinblue-personalization',
    '#tib-personalization',
    // Custom elements (Teeinblue might use web components)
    'teeinblue-personalization',
    'teeinblue-customizer',
    'tib-personalization',
    // App block wrapper (Shopify's app block container)
    '[data-shopify-block-id*="teeinblue"]',
    '[data-block-id*="teeinblue"]',
    // Generic app block selectors
    '.shopify-app-block[data-block-id*="teeinblue"]',
    '.shopify-app-block:has([class*="teeinblue"])',
    '.shopify-app-block:has([id*="teeinblue"])',
    // iframe-based apps
    'iframe[src*="teeinblue"]',
    'iframe[src*="tib"]',
  ];

  // Selectors for the main product section (fallback)
  // Priority: Shopify section wrapper first, then inner elements
  const PRODUCT_SECTION_SELECTORS = [
    // Shopify section wrappers (contain the FULL section + app blocks)
    '.shopify-section[id*="product-information"]',
    '.shopify-section[id*="main-product"]',
    '.shopify-section:has(.product-information)',
    '#shopify-section-main',
    '[id^="shopify-section-"][id*="product"]',
    // Section-level containers
    '[data-section-type="product-information"]',
    '[data-section-id*="product"]',
    // Inner product containers (less ideal - may miss app blocks)
    '.product-information',
    'section.product',
    '#MainProduct',
    '[data-product-id]',
  ];

  // Cache for fetched HTML
  const cache = new Map();

  // Track observers for cleanup
  const observers = new WeakMap();

  /**
   * Logger utility
   */
  const log = (debug, ...args) => {
    if (debug) {
      console.log('[home-teeinblue]', ...args);
    }
  };

  /**
   * Get preview parameters from URL (for theme editor)
   */
  const getPreviewParams = () => {
    const params = new URLSearchParams(window.location.search);
    const out = {};
    ['preview_theme_id', 'locale'].forEach((key) => {
      if (params.has(key)) {
        out[key] = params.get(key);
      }
    });
    return out;
  };

  /**
   * Build URL for fetching product page
   * Note: We do NOT add section_id - we want the full page
   */
  const buildUrl = (handle, debug) => {
    const root = (window.Shopify?.routes?.root) || '/';
    const url = new URL(`${root}products/${handle}`, window.location.origin);

    // Add preview params if in theme editor
    const preview = getPreviewParams();
    Object.entries(preview).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    // Cache buster for design mode
    if (window.Shopify?.designMode) {
      url.searchParams.set('_t', Date.now().toString());
    }

    log(debug, 'Fetch URL:', url.toString());
    return url;
  };

  /**
   * Fetch the full product page HTML
   */
  const fetchProductPage = async (handle, debug) => {
    const preview = getPreviewParams().preview_theme_id || '';
    const cacheKey = `${handle}|${preview}`;

    if (cache.has(cacheKey)) {
      log(debug, 'Using cached HTML');
      return cache.get(cacheKey);
    }

    const url = buildUrl(handle, debug);

    try {
      const response = await fetch(url.toString(), {
        credentials: 'same-origin',
        headers: {
          'Accept': 'text/html',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      log(debug, 'Fetched HTML length:', html.length);

      cache.set(cacheKey, html);
      return html;
    } catch (error) {
      log(debug, 'Fetch error:', error);
      throw error;
    }
  };

  /**
   * Parse HTML string into a document
   */
  const parseHtml = (html) => {
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
  };

  /**
   * Try to find an element using a list of selectors
   */
  const findWithSelectors = (doc, selectors, debug) => {
    for (const selector of selectors) {
      try {
        const element = doc.querySelector(selector);
        if (element) {
          log(debug, 'Found element with selector:', selector);
          return { element, selector };
        }
      } catch (e) {
        // Invalid selector, skip
        log(debug, 'Invalid selector:', selector, e.message);
      }
    }
    return null;
  };

  /**
   * Find all elements matching selectors (for collecting multiple app blocks)
   */
  const findAllWithSelectors = (doc, selectors, debug) => {
    const found = [];
    for (const selector of selectors) {
      try {
        const elements = doc.querySelectorAll(selector);
        elements.forEach((el) => {
          if (!found.some((f) => f.element === el)) {
            found.push({ element: el, selector });
          }
        });
      } catch (e) {
        // Invalid selector, skip
      }
    }
    log(debug, 'Found total elements:', found.length);
    return found;
  };

  /**
   * Extract content based on extraction mode
   */
  const extractContent = (doc, mode, customSelector, debug) => {
    log(debug, 'Extraction mode:', mode);

    switch (mode) {
      case 'app-block': {
        // Only extract Teeinblue app block elements
        const result = findWithSelectors(doc, TEEINBLUE_SELECTORS, debug);
        if (result) {
          return { elements: [result.element], selector: result.selector, mode: 'app-block' };
        }
        throw new Error('Teeinblue app block not found');
      }

      case 'product-section': {
        // Extract the full product section
        const result = findWithSelectors(doc, PRODUCT_SECTION_SELECTORS, debug);
        if (result) {
          return { elements: [result.element], selector: result.selector, mode: 'product-section' };
        }
        throw new Error('Product section not found');
      }

      case 'custom': {
        // Use custom selector
        if (!customSelector) {
          throw new Error('Custom selector not provided');
        }
        const element = doc.querySelector(customSelector);
        if (element) {
          return { elements: [element], selector: customSelector, mode: 'custom' };
        }
        throw new Error(`Custom selector "${customSelector}" not found`);
      }

      case 'auto':
      default: {
        // Try Teeinblue selectors first
        const tibResult = findWithSelectors(doc, TEEINBLUE_SELECTORS, debug);
        if (tibResult) {
          return { elements: [tibResult.element], selector: tibResult.selector, mode: 'auto-teeinblue' };
        }

        // Fall back to product section
        log(debug, 'Teeinblue not found, falling back to product section');
        const productResult = findWithSelectors(doc, PRODUCT_SECTION_SELECTORS, debug);
        if (productResult) {
          return { elements: [productResult.element], selector: productResult.selector, mode: 'auto-product' };
        }

        throw new Error('Could not find Teeinblue or product section');
      }
    }
  };

  /**
   * Clone an element for injection
   */
  const cloneElement = (element) => {
    return element.cloneNode(true);
  };

  /**
   * Collect and extract stylesheets that might be needed
   */
  const extractStyles = (doc, debug) => {
    const styles = [];

    // Find Teeinblue-related stylesheets
    doc.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
      const href = link.getAttribute('href') || '';
      if (href.includes('teeinblue') || href.includes('tib')) {
        styles.push({ type: 'link', href });
        log(debug, 'Found Teeinblue stylesheet:', href);
      }
    });

    // Find inline styles that might be Teeinblue-related
    doc.querySelectorAll('style').forEach((style) => {
      const content = style.textContent || '';
      if (content.includes('teeinblue') || content.includes('tib')) {
        styles.push({ type: 'inline', content });
        log(debug, 'Found Teeinblue inline style');
      }
    });

    return styles;
  };

  /**
   * Extract scripts that need to be re-executed
   */
  const extractScripts = (doc, debug) => {
    const scripts = [];

    // Find Teeinblue-related scripts
    doc.querySelectorAll('script').forEach((script) => {
      const src = script.getAttribute('src') || '';
      const content = script.textContent || '';

      // Check if it's a Teeinblue script
      const isTeeinblue =
        src.includes('teeinblue') ||
        src.includes('tib') ||
        content.includes('teeinblue') ||
        content.includes('Teeinblue') ||
        content.includes('TIB');

      if (isTeeinblue) {
        scripts.push({
          src: src || null,
          content: src ? null : content,
          type: script.getAttribute('type') || 'text/javascript',
          async: script.hasAttribute('async'),
          defer: script.hasAttribute('defer'),
        });
        log(debug, 'Found Teeinblue script:', src || '(inline)');
      }
    });

    return scripts;
  };

  // Track injected styles to prevent duplicates
  const injectedStyles = new Set();

  /**
   * Inject stylesheets into the page
   */
  const injectStyles = (styles, debug) => {
    const fragment = document.createDocumentFragment();

    styles.forEach((style, index) => {
      if (style.type === 'link') {
        // Check if already exists (in DOM or our tracking set)
        if (!document.querySelector(`link[href="${style.href}"]`) && !injectedStyles.has(style.href)) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = style.href;
          link.dataset.homeTeeinblue = 'true';
          fragment.appendChild(link);
          injectedStyles.add(style.href);
          log(debug, 'Injecting stylesheet:', style.href);
        } else {
          log(debug, 'Stylesheet already exists, skipping:', style.href);
        }
      } else if (style.type === 'inline') {
        // Create a hash of inline content to track duplicates
        const hash = style.content.substring(0, 100);
        if (!injectedStyles.has(hash)) {
          const styleEl = document.createElement('style');
          styleEl.textContent = style.content;
          styleEl.dataset.homeTeeinblue = 'true';
          fragment.appendChild(styleEl);
          injectedStyles.add(hash);
          log(debug, 'Injecting inline style');
        } else {
          log(debug, 'Inline style already exists, skipping');
        }
      }
    });

    if (fragment.children.length > 0) {
      document.head.appendChild(fragment);
    }
  };

  /**
   * Re-execute scripts safely
   */
  const hydrateScripts = (container, debug) => {
    const scripts = Array.from(container.querySelectorAll('script'));

    scripts.forEach((oldScript, index) => {
      const newScript = document.createElement('script');

      // Copy attributes
      Array.from(oldScript.attributes).forEach((attr) => {
        newScript.setAttribute(attr.name, attr.value);
      });

      // Copy content for inline scripts
      if (oldScript.textContent) {
        newScript.textContent = oldScript.textContent;
      }

      // Replace old with new to trigger execution
      oldScript.replaceWith(newScript);
      log(debug, 'Re-executed script:', index, newScript.src || '(inline)');
    });
  };

  /**
   * Inject external Teeinblue scripts
   */
  const injectExternalScripts = async (scripts, debug) => {
    for (const script of scripts) {
      if (script.src) {
        // Check if already loaded
        if (document.querySelector(`script[src="${script.src}"]`)) {
          log(debug, 'Script already loaded:', script.src);
          continue;
        }

        await new Promise((resolve, reject) => {
          const el = document.createElement('script');
          el.src = script.src;
          el.type = script.type;
          if (script.async) el.async = true;
          if (script.defer) el.defer = true;
          el.dataset.homeTeeinblue = 'true';
          el.onload = resolve;
          el.onerror = reject;
          document.body.appendChild(el);
          log(debug, 'Injecting external script:', script.src);
        });
      }
    }
  };

  /**
   * Render error state
   */
  const renderError = (container, handle, errorText, debug, error) => {
    const preview = getPreviewParams().preview_theme_id;
    const productUrl = new URL(`/products/${handle}`, window.location.origin);
    if (preview) {
      productUrl.searchParams.set('preview_theme_id', preview);
    }

    container.innerHTML = `
      <div class="home-teeinblue-error">
        <p>${errorText}</p>
        <p><a href="${productUrl.toString()}">View product page</a></p>
      </div>
    `;

    if (debug) {
      const pre = document.createElement('pre');
      pre.className = 'home-teeinblue-debug';
      pre.textContent = [
        `Error: ${error?.message || 'Unknown error'}`,
        `Handle: ${handle}`,
        `URL: ${productUrl.toString()}`,
        `Stack: ${error?.stack || 'N/A'}`,
      ].join('\n');
      container.appendChild(pre);
    }

    container.setAttribute('aria-busy', 'false');
    window.dispatchEvent(new CustomEvent(EVENT_ERROR, { detail: { handle, error } }));
    log(debug, 'Error rendered:', error);
  };

  /**
   * Main injection function
   */
  const inject = async (container, force = false) => {
    if (container.dataset.initialized === 'true' && !force) {
      return;
    }

    const debug = container.dataset.debug === 'true';
    const handle = container.dataset.productHandle;
    const mode = container.dataset.extractionMode || 'auto';
    const customSelector = container.dataset.customSelector || '';
    const loadingText = container.dataset.loadingText || 'Loading...';
    const errorText = container.dataset.errorText || 'Could not load customizer.';

    log(debug, 'Starting injection', { handle, mode, customSelector });

    if (!handle) {
      renderError(container, '', errorText, debug, new Error('No product handle provided'));
      return;
    }

    container.dataset.initialized = 'true';
    container.innerHTML = `
      <div class="home-teeinblue-loading" aria-label="${loadingText}">
        <span class="home-teeinblue-loading__spinner"></span>
        <span class="home-teeinblue-loading__text">${loadingText}</span>
      </div>
    `;

    try {
      // 1. Fetch full product page HTML
      const html = await fetchProductPage(handle, debug);

      // 2. Parse HTML
      const doc = parseHtml(html);
      log(debug, 'Parsed document title:', doc.title);

      // 3. Debug: Comprehensive scan for Teeinblue and app blocks
      if (debug) {
        console.group('[home-teeinblue] Document Analysis');

        // List all Shopify sections
        const allSections = doc.querySelectorAll('.shopify-section, [class*="shopify-section"]');
        console.log(`Found ${allSections.length} Shopify sections:`);
        allSections.forEach((sec, i) => {
          console.log(`  ${i}: id="${sec.id}" class="${sec.className}"`);
        });

        // Check main content
        const mainContent = doc.querySelector('#MainContent, main, [role="main"]');
        if (mainContent) {
          console.log('Main content children:', mainContent.children.length);
        }

        // Scan for ALL possible Teeinblue elements
        console.log('--- Teeinblue Element Scan ---');
        const teeinbluePatterns = [
          '[class*="teeinblue"]',
          '[class*="tib-"]',
          '[class*="TIB"]',
          '[id*="teeinblue"]',
          '[id*="tib"]',
          '[data-teeinblue]',
          '[data-tib]',
          'teeinblue-personalization',
          'iframe[src*="teeinblue"]',
          'iframe[src*="personalize"]',
          'script[src*="teeinblue"]',
        ];

        teeinbluePatterns.forEach(pattern => {
          try {
            const matches = doc.querySelectorAll(pattern);
            if (matches.length > 0) {
              console.log(`  "${pattern}": ${matches.length} matches`);
              matches.forEach((el, i) => {
                console.log(`    ${i}: <${el.tagName.toLowerCase()}> id="${el.id}" class="${el.className}"`);
                if (el.tagName === 'IFRAME') {
                  console.log(`       src="${el.src}"`);
                }
                if (el.tagName === 'SCRIPT') {
                  console.log(`       src="${el.src || '(inline)'}"`);
                }
              });
            }
          } catch (e) { /* invalid selector */ }
        });

        // Scan for app blocks
        console.log('--- App Block Scan ---');
        const appBlockPatterns = [
          '.shopify-app-block',
          '[data-shopify-block-id]',
          '[data-block-id]',
          '[class*="app-block"]',
        ];

        appBlockPatterns.forEach(pattern => {
          try {
            const matches = doc.querySelectorAll(pattern);
            if (matches.length > 0) {
              console.log(`  "${pattern}": ${matches.length} matches`);
              matches.forEach((el, i) => {
                console.log(`    ${i}: <${el.tagName.toLowerCase()}> id="${el.id}" class="${el.className}"`);
                console.log(`       innerHTML preview: ${el.innerHTML.substring(0, 200)}...`);
              });
            }
          } catch (e) { /* invalid selector */ }
        });

        // Look for script tags that might load Teeinblue
        console.log('--- Script Scan (app-related) ---');
        doc.querySelectorAll('script[src]').forEach(script => {
          const src = script.src || '';
          if (src.includes('teeinblue') || src.includes('tib') || src.includes('personalize') || src.includes('apps.shopify')) {
            console.log(`  Script: ${src}`);
          }
        });

        console.groupEnd();
      }

      // 4. Extract styles first
      const styles = extractStyles(doc, debug);
      injectStyles(styles, debug);

      // 4. Extract Teeinblue scripts (we'll inject them after DOM)
      const externalScripts = extractScripts(doc, debug);

      // 5. Extract content
      const { elements, selector, mode: usedMode } = extractContent(doc, mode, customSelector, debug);
      log(debug, 'Extraction result:', { count: elements.length, selector, usedMode });

      // Debug: Log what we found
      if (debug) {
        elements.forEach((el, i) => {
          console.log(`[home-teeinblue] Element ${i}:`, {
            tagName: el.tagName,
            id: el.id,
            className: el.className,
            childCount: el.children.length,
            innerHTML: el.innerHTML.substring(0, 500) + '...'
          });
          // Check for app blocks
          const appBlocks = el.querySelectorAll('[class*="app-block"], [data-block-id], [class*="teeinblue"], [class*="tib"]');
          console.log(`[home-teeinblue] Found ${appBlocks.length} potential app blocks in element ${i}`);
        });
      }

      // 6. Create wrapper and inject elements
      container.innerHTML = '';
      const wrapper = document.createElement('div');
      wrapper.className = 'home-teeinblue-injected';
      wrapper.dataset.extractedWith = selector;
      wrapper.dataset.extractionMode = usedMode;

      elements.forEach((el) => {
        wrapper.appendChild(cloneElement(el));
      });

      container.appendChild(wrapper);
      container.setAttribute('aria-busy', 'false');

      // 7. Re-execute inline scripts within the injected content
      hydrateScripts(wrapper, debug);

      // 8. Inject external Teeinblue scripts if not already loaded
      await injectExternalScripts(externalScripts, debug);

      // 9. Dispatch success event
      window.dispatchEvent(new CustomEvent(EVENT_LOADED, {
        detail: { handle, selector, mode: usedMode }
      }));

      log(debug, 'Injection complete');

      // 10. Force Teeinblue elements to be visible
      // Teeinblue hides itself when not on a /products/* URL
      const forceTeeinblueVisible = () => {
        const teeinblueElements = wrapper.querySelectorAll(
          '#teeinblue-form, [id*="teeinblue"], .shopify-app-block[id*="teeinblue"], .teeinblue-loading-container, [class*="teeinblue"]'
        );
        teeinblueElements.forEach(el => {
          const computed = getComputedStyle(el);
          if (el.style.display === 'none' || computed.display === 'none') {
            el.style.setProperty('display', 'block', 'important');
            log(debug, 'Forced Teeinblue element visible:', el.id || el.className);
          }
          if (el.style.visibility === 'hidden' || computed.visibility === 'hidden') {
            el.style.setProperty('visibility', 'visible', 'important');
          }
          if (computed.height === '0px') {
            el.style.setProperty('height', 'auto', 'important');
          }
        });
      };

      // Run immediately
      forceTeeinblueVisible();

      // Watch for Teeinblue hiding itself (it may do this after async init)
      const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
          if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            const target = mutation.target;
            const isTeeinblue = target.id?.includes('teeinblue') ||
                               target.className?.includes('teeinblue') ||
                               target.classList?.contains('teeinblue-loading-container');
            if (isTeeinblue) {
              if (target.style.display === 'none') {
                target.style.setProperty('display', 'block', 'important');
                log(debug, 'Intercepted Teeinblue hide, forcing visible:', target.id || target.className);
              }
            }
          }
        });
      });

      observer.observe(wrapper, {
        attributes: true,
        attributeFilter: ['style'],
        subtree: true
      });

      // Also run after a short delay (Teeinblue may set display:none after init)
      setTimeout(forceTeeinblueVisible, 500);
      setTimeout(forceTeeinblueVisible, 1500);
      setTimeout(forceTeeinblueVisible, 3000);

      // 11. Trigger Shopify events that apps might listen for (but NOT our own listener)
      if (window.Shopify?.PaymentButton) {
        window.Shopify.PaymentButton.init();
      }

      // Note: We intentionally do NOT dispatch shopify:section:load here
      // as it would trigger our own listener and cause an infinite loop.

    } catch (error) {
      renderError(container, handle, errorText, debug, error);
    }
  };

  /**
   * Initialize with IntersectionObserver for lazy loading
   */
  const observeAndInit = (node) => {
    if (!('IntersectionObserver' in window)) {
      inject(node);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            inject(node);
            io.disconnect();
          }
        });
      },
      { rootMargin: '200px' }
    );

    observers.set(node, io);
    io.observe(node);
  };

  /**
   * Initialize all containers in a root
   */
  const initAll = (root = document) => {
    const nodes = Array.from(root.querySelectorAll(SELECTOR));
    nodes.forEach((node) => {
      if (node.dataset.initialized !== 'true') {
        observeAndInit(node);
      }
    });
  };

  /**
   * Cleanup observers for a section
   */
  const cleanupForSection = (sectionEl) => {
    const nodes = Array.from(sectionEl.querySelectorAll(SELECTOR));
    nodes.forEach((node) => {
      const io = observers.get(node);
      if (io) {
        io.disconnect();
        observers.delete(node);
      }
      delete node.dataset.initialized;
    });
  };

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initAll());
  } else {
    initAll();
  }

  // Handle Shopify theme editor events
  document.addEventListener('shopify:section:load', (e) => {
    const section = e.target;
    cleanupForSection(section);
    initAll(section);
  });

  document.addEventListener('shopify:section:select', (e) => {
    const section = e.target;
    cleanupForSection(section);
    initAll(section);
  });

  document.addEventListener('shopify:section:unload', (e) => {
    const section = e.target;
    cleanupForSection(section);
  });

  // Expose for debugging
  window.__homeTeeinblueEmbed = {
    inject,
    initAll,
    cache,
    TEEINBLUE_SELECTORS,
    PRODUCT_SECTION_SELECTORS,
  };
})();
