(function (global) {
  var SESSION_KEY = 'ad_dashboard_session';
  var DEFAULT_PASSWORD = 'enerjoy.life';

  var USERS = {
    admin: { username: 'admin', role: 'admin', displayName: 'Admin' },
    alina: { username: 'alina', role: 'optimizer', optimizer: 'Alina', displayName: 'Alina' },
    barry: { username: 'barry', role: 'optimizer', optimizer: 'Barry', displayName: 'Barry' },
    angie: { username: 'angie', role: 'optimizer', optimizer: 'Angie', displayName: 'Angie' },
    dom: { username: 'dom', role: 'optimizer', optimizer: 'Dom', displayName: 'Dom' },
  };

  function login(username, password) {
    var key = (username || '').trim().toLowerCase();
    var user = USERS[key];
    if (!user || password !== DEFAULT_PASSWORD) {
      return { ok: false, error: '用户名或密码错误' };
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      username: key,
      loggedInAt: Date.now(),
    }));
    return { ok: true, user: getSessionUser() };
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
  }

  function getSessionUser() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var session = JSON.parse(raw);
      var user = USERS[session.username];
      if (!user) return null;
      return Object.assign({}, user);
    } catch (e) {
      return null;
    }
  }

  global.AdAuth = {
    login: login,
    logout: logout,
    getSessionUser: getSessionUser,
  };
})(window);
