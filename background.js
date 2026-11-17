let running = false;

/**
 * Clicking the toolbar icon combines all windows into the clicked
 * window, sorts its tabs and removes duplicates.
 *
 * The result is shown in the icon's tooltip.
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (running) {
    return;
  }

  running = true;

  try {
    const messages = [];

    for (const action of [combineAllWindows, sortCurrentWindow, removeDuplicates]) {
      messages.push(await action(tab.windowId));
    }

    await chrome.action.setTitle({ title: messages.join(" ") });
  } catch (error) {
    console.error(error);
    await chrome.action.setTitle({ title: `Error: ${error.message}` });
  } finally {
    running = false;
  }
});

/**
 * Combine all browser windows into the current window.
 *
 * The window whose toolbar icon was clicked is the destination.
 * Pinned tabs remain pinned.
 */
async function combineAllWindows(windowId) {
  const windows = await chrome.windows.getAll({
    populate: true
  });

  const otherWindows = windows.filter(
    window => window.id !== windowId
  );

  if (otherWindows.length === 0) {
    return "Only one window is open.";
  }

  let movedCount = 0;

  for (const window of otherWindows) {
    const tabs = window.tabs || [];

    // Move tabs one window at a time.
    // Moving all tabs to index -1 appends them to the destination.
    const movableTabs = tabs.filter(tab => tab.id != null);

    if (movableTabs.length === 0) {
      continue;
    }

    await chrome.tabs.move(
      movableTabs.map(tab => tab.id),
      {
        windowId,
        index: -1
      }
    );

    movedCount += movableTabs.length;
  }

  return (
    `Combined ${otherWindows.length} window${otherWindows.length === 1 ? "" : "s"
    } (${movedCount} tabs).`
  );
}

/**
 * Sort tabs in the current window.
 *
 * Pinned tabs stay where they are.
 * Unpinned tabs are sorted by hostname, then by title, then URL.
 */
async function sortCurrentWindow(windowId) {
  const currentWindow = await chrome.windows.get(windowId, {
    populate: true
  });

  const tabs = currentWindow.tabs || [];

  const pinnedTabs = tabs.filter(tab => tab.pinned);
  const unpinnedTabs = tabs.filter(tab => !tab.pinned);

  if (unpinnedTabs.length < 2) {
    return "Nothing to sort.";
  }

  const getHost = (tab) => {
    try {
      return new URL(tab.url || "").hostname.toLowerCase();
    } catch {
      return "";
    }
  };

  unpinnedTabs.sort((a, b) => {
    const hostA = getHost(a);
    const hostB = getHost(b);

    const hostComparison = hostA.localeCompare(hostB);
    if (hostComparison !== 0) {
      return hostComparison;
    }

    const titleA = (a.title || "").toLowerCase();
    const titleB = (b.title || "").toLowerCase();

    const titleComparison = titleA.localeCompare(titleB);
    if (titleComparison !== 0) {
      return titleComparison;
    }

    return (a.url || "").localeCompare(b.url || "");
  });

  // Move tabs in sorted order, starting immediately after
  // the pinned tabs.
  for (let index = 0; index < unpinnedTabs.length; index++) {
    await chrome.tabs.move(unpinnedTabs[index].id, {
      windowId: currentWindow.id,
      index: pinnedTabs.length + index
    });
  }

  return `Sorted ${unpinnedTabs.length} tabs.`;
}

/**
 * Remove duplicate tabs from the current window.
 *
 * The first occurrence is kept.
 * Pinned tabs are never removed.
 *
 * URLs are compared after removing the fragment (#...).
 */
async function removeDuplicates(windowId) {
  const currentWindow = await chrome.windows.get(windowId, {
    populate: true
  });

  const tabs = currentWindow.tabs || [];
  const seen = new Set();
  const duplicateIds = [];

  for (const tab of tabs) {
    // Never automatically remove pinned tabs.
    if (tab.pinned) {
      continue;
    }

    if (!tab.url || tab.id == null) {
      continue;
    }

    let normalizedUrl;

    try {
      const url = new URL(tab.url);

      // Fragments generally don't represent a different page
      // for the purposes of duplicate-tab detection.
      url.hash = "";

      normalizedUrl = url.href;
    } catch {
      // If the URL cannot be parsed, use it as-is.
      normalizedUrl = tab.url;
    }

    if (seen.has(normalizedUrl)) {
      duplicateIds.push(tab.id);
    } else {
      seen.add(normalizedUrl);
    }
  }

  if (duplicateIds.length === 0) {
    return "No duplicates found.";
  }

  await chrome.tabs.remove(duplicateIds);

  return (
    `Removed ${duplicateIds.length} duplicate${duplicateIds.length === 1 ? "" : "s"
    }.`
  );
}
