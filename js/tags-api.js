(function () {
  var CACHE_PREFIX = 'ad_tags_';
  var POLL_MS = 30000;
  var API_VERSION = '2022-11-28';

  function getConfig() {
    return window.AdTagsConfig || null;
  }

  function isWritable() {
    var cfg = getConfig();
    return !!(cfg && cfg.token && cfg.owner && cfg.repo);
  }

  function cacheKey(platform) {
    return CACHE_PREFIX + platform;
  }

  function contentPath(platform) {
    return 'public/' + platform + '/creative-tags.json';
  }

  function githubContentsUrl(platform, cfg) {
    return 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo
      + '/contents/' + contentPath(platform) + '?ref=' + (cfg.branch || 'main');
  }

  function apiHeaders(cfg, extra) {
    var h = {
      Authorization: 'Bearer ' + cfg.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
    };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  function readCache(platform) {
    try {
      var raw = sessionStorage.getItem(cacheKey(platform));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeCache(platform, payload) {
    try {
      sessionStorage.setItem(cacheKey(platform), JSON.stringify(payload));
    } catch (e) { /* ignore quota */ }
  }

  function decodeGitHubContent(content) {
    if (!content) return {};
    var binary = atob(content.replace(/\n/g, ''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    var text = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(text);
  }

  function encodeGitHubContent(obj) {
    var text = JSON.stringify(obj, null, 2) + '\n';
    var bytes = new TextEncoder().encode(text);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function parseApiError(res, bodyText) {
    var msg = 'GitHub API ' + res.status;
    try {
      var j = JSON.parse(bodyText);
      if (j && j.message) msg += ': ' + j.message;
    } catch (e) {
      if (bodyText) msg += ': ' + bodyText.slice(0, 200);
    }
    return new Error(msg);
  }

  var stateByPlatform = {};

  function ensureState(platform) {
    if (!stateByPlatform[platform]) {
      stateByPlatform[platform] = {
        sha: null,
        tags: {},
        listeners: [],
        saveQueue: [],
        saving: false,
        saveChain: null,
        pollTimer: null,
      };
    }
    return stateByPlatform[platform];
  }

  function notify(platform) {
    var st = ensureState(platform);
    st.listeners.forEach(function (fn) {
      try { fn(st.tags, st.sha); } catch (e) { console.error(e); }
    });
  }

  function applyTags(platform, tags, sha, persist) {
    var st = ensureState(platform);
    st.tags = tags || {};
    if (sha !== undefined) st.sha = sha;
    if (persist !== false) {
      writeCache(platform, { sha: st.sha, tags: st.tags, fetchedAt: Date.now() });
    }
    notify(platform);
  }

  function fetchStatic(platform) {
    return fetch('./public/' + platform + '/creative-tags.json')
      .then(function (res) {
        if (!res.ok) throw new Error('标签文件加载失败');
        return res.json();
      })
      .then(function (json) {
        return { tags: json.tags || {}, sha: null };
      });
  }

  function fetchFromGitHub(platform) {
    var cfg = getConfig();
    if (!cfg || !cfg.token) return fetchStatic(platform);
    return fetch(githubContentsUrl(platform, cfg), {
      headers: apiHeaders(cfg),
    }).then(function (res) {
      return res.text().then(function (text) {
        if (res.status === 404) return { tags: {}, sha: null };
        if (!res.ok) throw parseApiError(res, text);
        var data = JSON.parse(text);
        if (!data.content) return { tags: {}, sha: data.sha || null };
        var json = decodeGitHubContent(data.content);
        return { tags: json.tags || {}, sha: data.sha || null };
      });
    });
  }

  function loadTags(platform) {
    var cached = readCache(platform);
    if (cached && cached.tags) {
      applyTags(platform, cached.tags, cached.sha, false);
    }
    return fetchFromGitHub(platform).then(function (result) {
      var st = ensureState(platform);
      var remoteEmpty = !result.tags || !Object.keys(result.tags).length;
      var cacheHasTags = cached && cached.tags && Object.keys(cached.tags).length > 0;
      if (remoteEmpty && cacheHasTags && !result.sha) {
        return { tags: st.tags, sha: st.sha };
      }
      if (!cached || result.sha !== st.sha) {
        applyTags(platform, result.tags, result.sha);
      }
      return { tags: st.tags, sha: st.sha };
    }).catch(function (err) {
      if (cached) return { tags: cached.tags, sha: cached.sha };
      throw err;
    });
  }

  function getCachedTags(platform) {
    var st = ensureState(platform);
    if (st.tags && Object.keys(st.tags).length) return st.tags;
    var cached = readCache(platform);
    return cached && cached.tags ? cached.tags : {};
  }

  function subscribe(platform, fn) {
    var st = ensureState(platform);
    st.listeners.push(fn);
    return function () {
      var idx = st.listeners.indexOf(fn);
      if (idx >= 0) st.listeners.splice(idx, 1);
    };
  }

  function extractShaFromPutResponse(data) {
    if (data && data.content && data.content.sha) return data.content.sha;
    if (data && data.commit && data.commit.sha) return data.commit.sha;
    return null;
  }

  function putTags(platform, retry) {
    var cfg = getConfig();
    if (!cfg || !cfg.token) return Promise.reject(new Error('未配置 Token'));
    var st = ensureState(platform);
    var body = {
      version: 1,
      updatedAt: new Date().toISOString(),
      tags: st.tags,
    };
    var payload = {
      message: 'chore: update creative tags (' + platform + ')',
      content: encodeGitHubContent(body),
      branch: cfg.branch || 'main',
    };
    if (st.sha) payload.sha = st.sha;
    return fetch(githubContentsUrl(platform, cfg), {
      method: 'PUT',
      headers: apiHeaders(cfg, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    }).then(function (res) {
      return res.text().then(function (text) {
        if (res.status === 409 && !retry) {
          return fetchFromGitHub(platform).then(function (fresh) {
            var merged = Object.assign({}, fresh.tags, st.tags);
            st.tags = merged;
            st.sha = fresh.sha;
            return putTags(platform, true);
          });
        }
        if (!res.ok) throw parseApiError(res, text);
        var data = JSON.parse(text);
        var newSha = extractShaFromPutResponse(data);
        if (!newSha) {
          throw new Error('GitHub 保存成功但未返回 sha，请刷新后重试');
        }
        st.sha = newSha;
        writeCache(platform, { sha: st.sha, tags: st.tags, fetchedAt: Date.now() });
        notify(platform);
        return { sha: st.sha, tags: st.tags };
      });
    });
  }

  function runSaveQueue(platform) {
    var st = ensureState(platform);
    if (!st.saveQueue.length) return Promise.resolve({ tags: st.tags, sha: st.sha });
    var pending = st.saveQueue.splice(0);
    pending.forEach(function (item) {
      var text = item.tagText == null ? '' : String(item.tagText);
      if (text.trim()) st.tags[item.creative] = text;
      else delete st.tags[item.creative];
    });
    return putTags(platform, false).catch(function (err) {
      st.saveQueue = pending.concat(st.saveQueue);
      throw err;
    });
  }

  function processSaveQueue(platform) {
    var st = ensureState(platform);
    if (st.saveChain) return st.saveChain;
    st.saveChain = Promise.resolve()
      .then(function loop() {
        if (!st.saveQueue.length) return { tags: st.tags, sha: st.sha };
        st.saving = true;
        return runSaveQueue(platform).then(function () {
          st.saving = false;
          return loop();
        });
      })
      .catch(function (err) {
        st.saving = false;
        throw err;
      })
      .finally(function () {
        st.saveChain = null;
      });
    return st.saveChain;
  }

  function saveTag(platform, creative, tagText) {
    if (!isWritable()) return Promise.reject(new Error('标签只读'));
    var st = ensureState(platform);
    st.saveQueue.push({ creative: creative, tagText: tagText });
    return processSaveQueue(platform);
  }

  function pollIfStale(platform) {
    if (!isWritable()) return;
    var st = ensureState(platform);
    if (st.saving || st.saveQueue.length || st.saveChain) return;
    fetchFromGitHub(platform).then(function (result) {
      if (st.saving || st.saveQueue.length || st.saveChain) return;
      if (result.sha && result.sha !== st.sha) {
        applyTags(platform, result.tags, result.sha);
      }
    }).catch(function () { /* ignore poll errors */ });
  }

  function startPolling(platform) {
    stopPolling(platform);
    if (!isWritable()) return;
    var st = ensureState(platform);
    st.pollTimer = setInterval(function () {
      pollIfStale(platform);
    }, POLL_MS);
  }

  function stopPolling(platform) {
    var st = ensureState(platform);
    if (st.pollTimer) {
      clearInterval(st.pollTimer);
      st.pollTimer = null;
    }
  }

  function splitTagTokens(tagText) {
    if (!tagText || !String(tagText).trim()) return [];
    return String(tagText)
      .split(/[,，、\s]+/)
      .map(function (t) { return t.trim(); })
      .filter(function (t) { return t.length > 0; });
  }

  function collectTagSuggestions(tagsMap) {
    var seen = {};
    var out = [];
    Object.keys(tagsMap || {}).forEach(function (key) {
      splitTagTokens(tagsMap[key]).forEach(function (token) {
        var norm = token.toLowerCase();
        if (!seen[norm]) {
          seen[norm] = true;
          out.push(token);
        }
      });
    });
    out.sort(function (a, b) { return a.localeCompare(b, 'zh-CN'); });
    return out;
  }

  window.AdTagsApi = {
    loadTags: loadTags,
    getCachedTags: getCachedTags,
    saveTag: saveTag,
    subscribe: subscribe,
    startPolling: startPolling,
    stopPolling: stopPolling,
    pollIfStale: pollIfStale,
    isWritable: isWritable,
    splitTagTokens: splitTagTokens,
    collectTagSuggestions: collectTagSuggestions,
  };
})();
