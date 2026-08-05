(function (global) {
  'use strict';

  function messageFromError(error, fallback) {
    if (error && error.context && typeof error.context.json === 'function') {
      return error.context.json().then(function (body) {
        return body && body.error ? body.error : fallback;
      }).catch(function () { return fallback; });
    }
    return Promise.resolve(error && error.message ? error.message : fallback);
  }

  function createAccountService(supabaseClient) {
    async function invoke(name, body, fallback) {
      var result = await supabaseClient.functions.invoke(name, { body: body });
      if (result.error) throw new Error(await messageFromError(result.error, fallback));
      if (!result.data || result.data.ok === false) throw new Error((result.data && result.data.error) || fallback);
      return result.data;
    }

    return {
      login: async function (username, password) {
        var response = await invoke('username-login', {
          username: username,
          password: password
        }, 'Username or password is incorrect.');
        var sessionResult = await supabaseClient.auth.setSession(response.session);
        if (sessionResult.error) throw sessionResult.error;
        return sessionResult.data.session;
      },
      list: function () {
        return invoke('account-admin', { action: 'list' }, 'Accounts could not be loaded.');
      },
      create: function (account) {
        return invoke('account-admin', { action: 'create', account: account }, 'Account could not be created.');
      },
      setActive: function (userId, isActive) {
        return invoke('account-admin', { action: 'set-active', userId: userId, isActive: isActive }, 'Account access could not be updated.');
      },
      resetPassword: function (userId, password) {
        return invoke('account-admin', { action: 'reset-password', userId: userId, password: password }, 'Password could not be reset.');
      }
    };
  }

  global.createAccountService = createAccountService;
}(window));
