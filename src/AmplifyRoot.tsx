import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { Amplify } from 'aws-amplify';
import { I18n } from 'aws-amplify/utils';
import { useState } from 'react';
import { App } from './App';
import { createAmplifyRepository } from './data/amplifyRepository';

I18n.putVocabularies({
  'zh-TW': {
    'Sign in': '登入',
    'Sign In': '登入',
    'Signing in': '登入中',
    Email: 'Email',
    'Enter your Email': '請輸入 Email',
    Password: '密碼',
    'Enter your Password': '請輸入密碼',
    'Forgot your password?': '忘記密碼？',
    'Reset Password': '重設密碼',
    'Send code': '傳送驗證碼',
    'Back to Sign In': '返回登入',
    'Change Password': '變更密碼',
    Changing: '變更中',
    'Confirm Password': '確認密碼',
    'Please confirm your Password': '請再次輸入密碼',
    'Incorrect username or password.': 'Email 或密碼不正確。',
    'User does not exist.': 'Email 或密碼不正確。',
  },
});
I18n.setLanguage('zh-TW');

export function AmplifyRoot({ outputs }: { outputs: Record<string, unknown> }) {
  const [repository] = useState(() => {
    Amplify.configure(outputs);
    return createAmplifyRepository();
  });

  return (
    <Authenticator hideSignUp>
      {({ signOut, user }) => (
        <App
          repository={repository}
          userLabel={user?.signInDetails?.loginId}
          onSignOut={signOut}
        />
      )}
    </Authenticator>
  );
}
