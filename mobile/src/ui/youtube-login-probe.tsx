import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'expo-router';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

import { useAppStore } from '../core/store';
import { normalizeYoutubeAvatarUrl } from './youtube-avatar-url';
import { isAllowedYoutubeProbeUrl } from './youtube-login-probe-url';
import { shouldProbeYoutubeLogin } from './youtube-login-probe-path';

const LOGIN_PROBE_URL = 'https://m.youtube.com/feed/channels?hl=zh-CN';
const LOGIN_PROBE_TTL_MS = 3 * 60 * 60 * 1000;
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

const LOGIN_CHECK_SCRIPT = `
(function(){
  function post(loggedIn){
    try{
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'youtube-login',
        loggedIn: loggedIn,
        avatar: avatarOf()
      }));
    }catch(e){}
  }
  function avatarOf(){
    try{
      var selectors=[
        'ytm-pivot-bar-item-renderer.pivot-you img',
        '.pivot-you img',
        '#avatar-btn img',
        'ytm-account-button img',
        'button[aria-label*="Account"] img',
        'a[href*="account"] img'
      ];
      for(var i=0;i<selectors.length;i++){
        var img=document.querySelector(selectors[i]);
        var src=img && (img.currentSrc || img.src || '');
        if(src) return src;
      }
    }catch(e){}
    return '';
  }
  function detectLogin(){
    try{
      if(document.querySelector('a[href*="SignOutOptions"], #avatar-btn, ytm-account-button')) return true;
      var text=(document.body&&document.body.innerText||'').toLowerCase();
      if(text.indexOf('sign in')>=0 || text.indexOf('登录')>=0) return false;
      return null;
    }catch(e){ return null; }
  }
  function check(){
    var value=detectLogin();
    if(value!==null) post(value);
  }
  setTimeout(check, 1200);
  setTimeout(check, 2600);
  setTimeout(check, 4500);
})();
true;
`;

const AnyWebView: any = WebView;

export function YoutubeLoginProbe({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const status = useAppStore((state) => state.youtubeLoginStatus);
  const checkedAt = useAppStore((state) => state.youtubeLoginCheckedAt);
  const setYoutubeLoginStatus = useAppStore((state) => state.setYoutubeLoginStatus);
  const setYoutubeAvatar = useAppStore((state) => state.setYoutubeAvatar);
  const [active, setActive] = useState(false);
  const [foregroundAt, setForegroundAt] = useState(0);
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webRef = useRef<any>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') setForegroundAt(Date.now());
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!enabled || Platform.OS === 'web' || !shouldProbeYoutubeLogin(pathname)) {
      setActive(false);
      return;
    }
    if (status !== 'unknown' && Date.now() - checkedAt < LOGIN_PROBE_TTL_MS) {
      setActive(false);
      return;
    }
    setActive(true);
  }, [enabled, foregroundAt, pathname, status, checkedAt]);

  useEffect(() => {
    if (!active) return;
    if (fallbackRef.current) clearTimeout(fallbackRef.current);
    fallbackRef.current = setTimeout(() => {
      setActive(false);
    }, 12000);
    return () => {
      if (fallbackRef.current) clearTimeout(fallbackRef.current);
    };
  }, [active]);

  if (!active || Platform.OS === 'web') return null;

  const onMessage = (event: WebViewMessageEvent) => {
    let message: any = null;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message?.type !== 'youtube-login' || typeof message.loggedIn !== 'boolean') {
      return;
    }
    setYoutubeLoginStatus(message.loggedIn ? 'loggedIn' : 'loggedOut');
    if (message.loggedIn) {
      const avatar = normalizeYoutubeAvatarUrl(message.avatar);
      if (avatar) setYoutubeAvatar(avatar);
    } else {
      setYoutubeAvatar('');
    }
    setActive(false);
  };

  return (
    <View pointerEvents="none" style={styles.probe}>
      <AnyWebView
        ref={webRef}
        source={{ uri: LOGIN_PROBE_URL }}
        style={styles.webview}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        setSupportMultipleWindows={false}
        userAgent={Platform.OS === 'ios' ? IOS_UA : ANDROID_UA}
        cacheEnabled
        onLoadEnd={() => {
          webRef.current?.injectJavaScript(LOGIN_CHECK_SCRIPT);
        }}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={(request: any) => {
          return isAllowedYoutubeProbeUrl(String(request.url || ''));
        }}
        injectedJavaScript={LOGIN_CHECK_SCRIPT}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  probe: {
    position: 'absolute',
    width: 360,
    height: 640,
    left: -380,
    top: 0,
    opacity: 0,
  },
  webview: { flex: 1, backgroundColor: '#FFFFFF' },
});
