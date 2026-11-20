import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

import { useAppStore } from '@/src/core/store';
import { Subscription } from '@/src/core/types';
import { resolveChannelInput } from '@/src/core/youtube/channel';
import { useAppTheme } from '@/src/ui/theme';

const AnyWebView: any = WebView;

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

const LOGIN_URL = 'https://m.youtube.com/feed/channels?hl=zh-CN';

const LOGIN_EARLY = `
(function(){
  try {
    Object.defineProperty(navigator, 'webdriver', { get: function(){ return false; } });
    window.chrome = window.chrome || { runtime: {} };
    var ua = navigator.userAgent || '';
    if (ua.indexOf('wv') >= 0) {
      Object.defineProperty(navigator, 'userAgent', {
        get: function(){ return ua.replace(/; wv\\)/, ')').replace(/ wv\\./, '.'); }
      });
    }
  } catch(e) {}
})();
true;
`;

const CHANNEL_BRIDGE = `
(function(){
  function post(payload){ try{ window.ReactNativeWebView.postMessage(JSON.stringify(payload)); }catch(e){} }
  function textOf(value){
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value.content === 'string') return value.content;
    if (value.simpleText) return value.simpleText;
    if (value.runs && value.runs.length) return value.runs.map(function(r){return r.text||'';}).join('');
    return '';
  }
  function normalizeUrl(url){
    var value=String(url||'');
    if (!value) return '';
    return value.indexOf('//')===0 ? 'https:'+value : value;
  }
  function thumbOf(value){
    var found='';
    function scan(node, depth){
      if(found || !node || depth>9) return;
      if(Array.isArray(node)){ for(var i=0;i<node.length;i++) scan(node[i], depth+1); return; }
      if(typeof node!=='object') return;
      var list=node.thumbnails || node.sources;
      if(Array.isArray(list) && list.length){
        for(var j=list.length-1;j>=0;j--){
          if(list[j] && list[j].url){ found=normalizeUrl(list[j].url); return; }
        }
      }
      for(var key in node){
        if(key==='thumbnails'||key==='sources') continue;
        if(node[key] && typeof node[key]==='object') scan(node[key], depth+1);
      }
    }
    scan(value,0);
    return found;
  }
  function parseData(){
    var items=[];
    var seen={};
    var byId={};
    var byHandle={};
    var dataCount=0;
    var domCount=0;
    var domLinks=0;
    var channelIdRe=/^UC[\\w-]{22}$/;
    function decodePart(value){
      var text=String(value||'');
      try{ return decodeURIComponent(text); }catch(e){ return text; }
    }
    function normalizeHandle(value){
      var handle=String(value||'').trim();
      if(!handle) return '';
      if(handle.indexOf('/@')===0) handle=handle.slice(1);
      if(handle.charAt(0)!=='@') handle='@'+handle;
      return '@'+decodePart(handle.slice(1));
    }
    function channelIdOf(value){
      var found='';
      function scan(node, depth){
        if(found || !node || depth>10) return;
        if(Array.isArray(node)){ for(var i=0;i<node.length;i++) scan(node[i], depth+1); return; }
        if(typeof node!=='object') return;
        var candidates=[node.channelId,node.contentId,node.browseId,node.externalId];
        for(var c=0;c<candidates.length;c++){
          var candidate=String(candidates[c]||'');
          if(channelIdRe.test(candidate)){ found=candidate; return; }
        }
        for(var key in node){
          if(key==='channelId'||key==='contentId'||key==='browseId'||key==='externalId') continue;
          if(node[key] && typeof node[key]==='object') scan(node[key], depth+1);
        }
      }
      scan(value,0);
      return found;
    }
    function handleOf(value){
      var found='';
      function scan(node, depth){
        if(found || !node || depth>9) return;
        if(Array.isArray(node)){ for(var i=0;i<node.length;i++) scan(node[i], depth+1); return; }
        if(typeof node!=='object') return;
        if(typeof node.canonicalBaseUrl==='string' && node.canonicalBaseUrl.indexOf('/@')===0){
          found=node.canonicalBaseUrl; return;
        }
        if(typeof node.url==='string'){
          var match=node.url.match(/\\/@([^/?#]+)/);
          if(match){ found='/@'+match[1]; return; }
        }
        for(var key in node){
          if(key==='canonicalBaseUrl'||key==='url') continue;
          if(node[key] && typeof node[key]==='object') scan(node[key], depth+1);
        }
      }
      scan(value,0);
      return normalizeHandle(found);
    }
    function titleOf(value){
      var title=textOf(value.title) || textOf(value.channelTitle) ||
        textOf(value.channelName) || textOf(value.name);
      if(title) return title;
      var metadata=value.metadata && value.metadata.lockupMetadataViewModel;
      return textOf(metadata && metadata.title);
    }
    function isChannelNode(node){
      if(!node || typeof node!=='object') return false;
      var type=String(node.contentType||'');
      if(type.indexOf('CHANNEL')>=0 && channelIdRe.test(String(node.contentId||''))) return true;
      if(channelIdRe.test(String(node.contentId||'')) && (titleOf(node)||handleOf(node))) return true;
      if(channelIdRe.test(String(node.channelId||''))) return true;
      return false;
    }
    function add(raw, source){
      if(!raw) return;
      var id=String(raw.channelId||'');
      if(!channelIdRe.test(id)) id='';
      var handle=normalizeHandle(raw.handle);
      var title=String(raw.title||'').trim();
      if(!id && !handle) return;
      if(!title) title=handle || id;
      var handleKey=handle.toLowerCase();
      var existing=(id && byId[id]) || (handleKey && byHandle[handleKey]) || null;
      if(existing){
        if(!existing.channelId && id){ existing.channelId=id; byId[id]=existing; seen[id]=true; }
        if(!existing.handle && handle){ existing.handle=handle; byHandle[handleKey]=existing; }
        if(!existing.title && title) existing.title=title;
        if(!existing.avatar && raw.avatar) existing.avatar=normalizeUrl(raw.avatar);
        return;
      }
      var key=id || ('h:'+handleKey);
      if(seen[key]) return;
      seen[key]=true;
      if(handleKey) seen['h:'+handleKey]=true;
      var item={ channelId:id, title:title, handle:handle, avatar:normalizeUrl(raw.avatar) };
      items.push(item);
      if(id) byId[id]=item;
      if(handleKey) byHandle[handleKey]=item;
      if(source==='data') dataCount++;
      if(source==='dom') domCount++;
    }
    function walk(node, depth){
      if(!node || depth>20) return;
      if(Array.isArray(node)){ for(var i=0;i<node.length;i++) walk(node[i], depth+1); return; }
      if(typeof node!=='object') return;
      if(isChannelNode(node)){
        add({ channelId:channelIdOf(node), title:titleOf(node), handle:handleOf(node), avatar:thumbOf(node) }, 'data');
      }
      for(var key in node){
        if(key==='channelId'||key==='contentId'||key==='title'||key==='channelTitle'||key==='thumbnail'||key==='navigationEndpoint'||key==='metadata'||key==='image') continue;
        if(node[key] && typeof node[key]==='object') walk(node[key], depth+1);
      }
    }
    function closestChannel(node){
      var selector='yt-lockup-view-model, ytm-channel-item-renderer, ytd-channel-renderer, ytd-grid-channel-renderer, ytm-compact-channel-renderer, ytd-compact-channel-renderer, ytm-channel-renderer';
      for(var i=0;i<8 && node;i++){
        try{ if(node.matches && node.matches(selector)) return node; }catch(e){}
        node=node.parentElement;
      }
      return null;
    }
    function domTitle(container, anchor){
      if(container){
        var selectors=['#channel-title','.channel-title','.ytLockupMetadataViewModelTitle','.yt-core-attributed-string[role="text"]','h3','yt-formatted-string','span[role="text"]'];
        for(var i=0;i<selectors.length;i++){
          var nodes=container.querySelectorAll(selectors[i]);
          for(var j=0;j<nodes.length;j++){
            var text=(nodes[j].textContent||'').trim();
            if(text) return text;
          }
        }
      }
      var own=(anchor.getAttribute('aria-label')||anchor.textContent||'').trim();
      return own.charAt(0)==='@' ? '' : own;
    }
    function collectDom(){
      var anchors=document.querySelectorAll('a[href]');
      for(var i=0;i<anchors.length;i++){
        var href=anchors[i].getAttribute('href')||'';
        var path=href.replace(/^https?:\\/\\/[^/]+/, '');
        var idMatch=path.match(/\\/channel\\/(UC[\\w-]{22})/);
        var handleMatch=path.match(/^\\/@([^/?#]+)/) || path.match(/\\/@([^/?#]+)/);
        if(!idMatch && !handleMatch) continue;
        domLinks++;
        var id=idMatch ? idMatch[1] : '';
        var handle=handleMatch ? normalizeHandle(handleMatch[1]) : '';
        var mapped=(id && byId[id]) || (handle && byHandle[handle.toLowerCase()]) || null;
        var container=closestChannel(anchors[i]) || anchors[i].parentElement;
        var title=domTitle(container, anchors[i]) || (mapped && mapped.title) || handle || id;
        var img=container ? container.querySelector('img') : null;
        var avatar=(img && (img.currentSrc || img.src)) || (mapped && mapped.avatar) || '';
        add({ channelId:id || (mapped && mapped.channelId) || '', title:title, handle:handle || (mapped && mapped.handle) || '', avatar:avatar }, 'dom');
      }
    }
    function addRoot(root){
      if(!root) return;
      if(typeof root==='string'){
        try{ root=JSON.parse(root); }catch(e){ return; }
      }
      try{ walk(root,0); }catch(e){}
    }
    try{ addRoot(window.ytInitialData); }catch(e){}
    try{
      var app=document.querySelector('ytd-app, ytm-app');
      if(app && app.data && app.data.response) addRoot(app.data.response);
    }catch(e){}
    try{
      var browse=document.querySelector('ytd-browse, ytm-browse');
      if(browse && browse.data && browse.data.response) addRoot(browse.data.response);
      else if(browse && browse.data) addRoot(browse.data);
    }catch(e){}
    collectDom();
    var unresolved=0;
    for(var u=0;u<items.length;u++){ if(!items[u].channelId) unresolved++; }
    post({
      type:'channels',
      items:items,
      loggedIn:detectLogin(),
      count:items.length,
      debug:{ data:dataCount, dom:domCount, domLinks:domLinks, unresolved:unresolved, path:location.pathname }
    });
  }
  function detectLogin(){
    try{
      if(document.querySelector('a[href*="SignOutOptions"], #avatar-btn, ytm-account-button')) return true;
      var text=(document.body&&document.body.innerText||'').toLowerCase();
      if(text.indexOf('sign in')>=0 || text.indexOf('登录')>=0) return false;
      return true;
    }catch(e){ return false; }
  }
  function pageState(){
    var text='';
    try{ text=(document.body&&document.body.innerText||'').toLowerCase(); }catch(e){}
    var blocked = text.indexOf('disallowed_useragent')>=0 ||
      text.indexOf('此浏览器或应用可能不安全')>=0 ||
      text.indexOf('this browser or app may not be secure')>=0 ||
      text.indexOf('couldn\\'t sign you in')>=0 ||
      text.indexOf('无法登录')>=0;
    post({ type:'page', url:location.href, loggedIn:detectLogin(), blocked:blocked });
  }
  window.__kissExtractChannels = function(){
    var tries=0;
    post({type:'status', text:'正在加载频道列表…'});
    function scrollDown(){
      try{ window.scrollTo(0, (document.body && document.body.scrollHeight) || 0); }catch(e){}
      try{
        var scroller=document.scrollingElement || document.documentElement;
        if(scroller) scroller.scrollTop=scroller.scrollHeight;
      }catch(e){}
      try{
        var app=document.querySelector('ytm-app, ytd-app');
        if(app) app.scrollTop=app.scrollHeight;
      }catch(e){}
    }
    function step(){
      tries++;
      scrollDown();
      if(tries<10){ setTimeout(step, 550); }
      else { setTimeout(parseData, 1000); }
    }
    step();
    return true;
  };
  setTimeout(pageState, 900);
  setTimeout(pageState, 3500);
  true;
})();
true;
`;

type ExtractedChannel = {
  channelId: string;
  title: string;
  handle?: string;
  avatar?: string;
};

type ExtractDebug = {
  data?: number;
  dom?: number;
  domLinks?: number;
  unresolved?: number;
  path?: string;
};

export default function YoutubeAccountScreen() {
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const addSubscriptions = useAppStore((state) => state.addSubscriptions);
  const subscriptions = useAppStore((state) => state.subscriptions);
  const webRef = useRef<any>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstLoadRef = useRef(true);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('请在下方网页中登录 YouTube 账号');
  const [extracting, setExtracting] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [blockedByGoogle, setBlockedByGoogle] = useState(false);
  const [failed, setFailed] = useState(false);
  const [lastCount, setLastCount] = useState<number | null>(null);

  const clearTimer = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  };

  const beginLoad = () => {
    clearTimer();
    setLoading(true);
    setFailed(false);
    timeoutRef.current = setTimeout(() => {
      // Never cover the WebView. Google's consent/login redirect chain can
      // legitimately take longer than 20 s on slow networks; hiding the page
      // behind an overlay made the previous build look "stuck forever".
      setLoading(false);
      setFailed(true);
      setStatus('页面仍在加载。可以继续等待，或点下方按钮重试/改用浏览器。');
    }, 20000);
  };

  useEffect(() => {
    beginLoad();
    return clearTimer;
  }, []);

  const reload = () => {
    setBlockedByGoogle(false);
    setStatus('正在重新打开 YouTube…');
    firstLoadRef.current = true;
    beginLoad();
    webRef.current?.reload();
  };

  const extract = () => {
    setExtracting(true);
    setStatus('正在读取你的订阅频道…');
    webRef.current?.injectJavaScript('window.__kissExtractChannels && window.__kissExtractChannels(); true;');
  };

  const importChannels = async (message: any) => {
    const debug = message.debug as ExtractDebug | undefined;
    const raw = ((message.items as ExtractedChannel[] | undefined) ?? []).filter(
      (item) => Boolean(item?.title && (item.channelId || item.handle))
    );
    if (!raw.length) {
      setExtracting(false);
      setLastCount(0);
      setStatus(
        debug
          ? `没有读取到频道（页面找到 ${debug.data ?? 0} 个数据项、${debug.domLinks ?? 0} 个频道链接）。请确认停在“订阅频道”页面后重试。`
          : '没有读取到频道。请确认已登录，并停在“订阅频道”页面后重试。'
      );
      return;
    }

    const direct = raw.filter(
      (item) => item.channelId?.startsWith('UC') && item.title
    );
    const pending = raw.filter(
      (item) => !item.channelId?.startsWith('UC') && item.handle
    );
    const resolved: Subscription[] = direct.map((item) => ({
      channelId: item.channelId,
      title: item.title,
      handle: item.handle || undefined,
      avatar: item.avatar || undefined,
      addedAt: Date.now(),
    }));
    let failed = raw.length - direct.length - pending.length;

    if (pending.length) {
      let cursor = 0;
      let finished = 0;
      setStatus(`已找到 ${raw.length} 个频道，正在解析 ${pending.length} 个账号…`);
      const worker = async () => {
        while (true) {
          const index = cursor++;
          if (index >= pending.length) return;
          const item = pending[index];
          try {
            const sub = await resolveChannelInput(item.handle as string);
            resolved.push({
              channelId: sub.channelId,
              title: sub.title || item.title,
              handle: sub.handle || item.handle,
              avatar: sub.avatar || item.avatar,
              addedAt: Date.now(),
            });
          } catch {
            failed++;
          }
          finished++;
          if (finished % 5 === 0 || finished === pending.length) {
            setStatus(
              `已找到 ${raw.length} 个频道，正在解析账号 ${finished}/${pending.length}…`
            );
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(4, pending.length) }, () => worker())
      );
    }

    setExtracting(false);
    const before = useAppStore.getState().subscriptions.length;
    addSubscriptions(resolved);
    const after = useAppStore.getState().subscriptions.length;
    const added = Math.max(0, after - before);
    setLastCount(resolved.length);
    const suffix = failed > 0 ? `，${failed} 个未能识别账号` : '';
    setStatus(
      resolved.length === 0
        ? `没有读取到有效的 Channel ID（找到 ${raw.length} 个频道项${suffix}）。请重试或改用 CSV 导入。`
        : `读取到 ${resolved.length} 个频道，新增 ${added} 个${suffix}。`
    );
    if (resolved.length > 0) {
      Alert.alert(
        '订阅已导入',
        `读取到 ${resolved.length} 个频道，新增 ${added} 个${suffix}。已自动去重。`,
        [
          { text: '继续登录', style: 'cancel' },
          { text: '回到发现页', onPress: () => router.replace('/' as any) },
        ]
      );
    }
  };

  const onMessage = (event: WebViewMessageEvent) => {
    let message: any = null;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message?.type === 'status') {
      setStatus(String(message.text ?? ''));
      return;
    }
    if (message?.type === 'page') {
      if (typeof message.loggedIn === 'boolean') setLoggedIn(message.loggedIn);
      if (typeof message.blocked === 'boolean') setBlockedByGoogle(message.blocked);
      if (message.blocked) {
        clearTimer();
        setLoading(false);
        setFailed(true);
        setStatus('Google 拦截了应用内登录，请改用 CSV 导入订阅。');
      }
      return;
    }
    if (message?.type === 'channels') {
      clearTimer();
      setLoading(false);
      if (typeof message.loggedIn === 'boolean') setLoggedIn(message.loggedIn);
      void importChannels(message);
      return;
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.bg }]}>
      <View style={[styles.header, { paddingTop: Math.max(10, insets.top) }]}>
        <Pressable
          style={[styles.iconButton, { backgroundColor: theme.colors.surfaceAlt }]}
          onPress={() => router.back()}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.colors.text }]}>YouTube 账户</Text>
          <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]} numberOfLines={1}>
            {loggedIn ? '已检测到登录态' : '登录后可同步订阅，并使用账号播放权限'}
          </Text>
        </View>
        <View
          style={[
            styles.avatar,
            { backgroundColor: loggedIn ? '#2FB980' : theme.colors.primarySoft },
          ]}
        >
          <Ionicons name={loggedIn ? 'checkmark' : 'person'} size={18} color="#FFFFFF" />
        </View>
      </View>

      <View
        style={[
          styles.notice,
          {
            backgroundColor: blockedByGoogle ? '#2A1719' : theme.colors.card,
            borderColor: blockedByGoogle ? '#63302F' : theme.colors.border,
          },
        ]}
      >
        <Ionicons
          name={blockedByGoogle ? 'alert-circle-outline' : 'information-circle-outline'}
          size={17}
          color={blockedByGoogle ? '#FF9D8A' : theme.colors.primary}
        />
        <Text style={[styles.noticeText, { color: theme.colors.textSecondary }]}>
          {blockedByGoogle
            ? 'Google 不允许在应用内嵌网页里登录。可以在电脑/手机浏览器登录后导出订阅 CSV，再从这里导入；已登录账号的播放权限仍可在播放器里尝试。'
            : '先在这里登录 YouTube，再点“导入订阅”。登录成功的 Cookie 会与播放器共享；若 Google 提示“此浏览器或应用可能不安全”，用 CSV 导入即可。'}
        </Text>
      </View>

      <View style={[styles.webCard, { borderColor: theme.colors.border }]}>
        <AnyWebView
          ref={webRef}
          source={{ uri: LOGIN_URL }}
          style={styles.webview}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          userAgent={Platform.OS === 'ios' ? IOS_UA : ANDROID_UA}
          injectedJavaScript={LOGIN_EARLY + CHANNEL_BRIDGE}
          cacheEnabled
          javaScriptCanOpenWindowsAutomatically
          onLoadStart={() => {
            if (firstLoadRef.current) {
              firstLoadRef.current = false;
              beginLoad();
            } else {
              setLoading(true);
            }
          }}
          onLoadEnd={() => {
            clearTimer();
            setLoading(false);
            setFailed(false);
            firstLoadRef.current = false;
            setStatus((current) =>
              current.startsWith('页面仍在加载') || current.startsWith('正在打开')
                ? '登录页已加载，请在网页中完成 Google 登录。'
                : current
            );
            webRef.current?.injectJavaScript(CHANNEL_BRIDGE);
          }}
          onError={() => {
            clearTimer();
            setLoading(false);
            setFailed(true);
            setStatus('网页加载失败，请检查网络后重试。');
          }}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={(request: any) => {
            const url = String(request.url || '');
            if (
              url.startsWith('about:') ||
              url.includes('youtube.com') ||
              url.includes('google.com') ||
              url.includes('gstatic.com') ||
              url.includes('googleusercontent.com')
            ) {
              return true;
            }
            Linking.openURL(url).catch(() => {});
            return false;
          }}
        />
        {loading ? (
          <View
            pointerEvents="none"
            style={[
              styles.loadBar,
              { backgroundColor: theme.dark ? 'rgba(20,16,28,.92)' : 'rgba(255,255,255,.94)' },
            ]}
          >
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5 }}>
              正在打开 YouTube… 首次可能需要 10–20 秒
            </Text>
          </View>
        ) : null}
      </View>

      {failed ? (
        <View
          style={[
            styles.failBanner,
            { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border },
          ]}
        >
          <Ionicons name="cloud-offline-outline" size={18} color={theme.colors.primary} />
          <Text style={{ flex: 1, color: theme.colors.textSecondary, fontSize: 11.5, lineHeight: 17 }}>
            页面加载较慢或没有出来。网页仍在下方继续加载，不会挡住登录界面。
          </Text>
          <Pressable onPress={reload} style={[styles.bannerButton, { backgroundColor: theme.colors.primary }]}>
            <Text style={{ color: '#FFFFFF', fontSize: 11.5, fontWeight: '800' }}>重试</Text>
          </Pressable>
          <Pressable
            onPress={() => Linking.openURL(LOGIN_URL).catch(() => {})}
            style={[styles.bannerButton, { backgroundColor: theme.colors.surface }]}
          >
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, fontWeight: '700' }}>浏览器</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.footer, { paddingBottom: Math.max(14, insets.bottom) }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.status, { color: theme.colors.textSecondary }]} numberOfLines={2}>
            {status}
          </Text>
          {lastCount !== null ? (
            <Text style={[styles.count, { color: theme.colors.textTertiary }]}>
              上次读取 {lastCount} 个频道 · 当前共 {subscriptions.length} 个
            </Text>
          ) : null}
        </View>
        <Pressable
          style={[styles.importButton, { backgroundColor: theme.colors.primary }, extracting && { opacity: 0.6 }]}
          disabled={extracting}
          onPress={extract}
        >
          {extracting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="download-outline" size={18} color="#FFFFFF" />
          )}
          <Text style={styles.importText}>{extracting ? '读取中…' : '导入订阅'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0812' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingBottom: 10 },
  iconButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#F5F2FF', fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { color: '#8D849D', fontSize: 11, marginTop: 2 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(124,92,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  avatarOn: { backgroundColor: '#2FB980' },
  notice: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: '#1B1427', marginHorizontal: 14, padding: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: '#2B223B' },
  noticeBlocked: { backgroundColor: '#2A1719', borderColor: '#63302F' },
  noticeText: { flex: 1, color: '#A99FBA', fontSize: 11.5, lineHeight: 17 },
  webCard: { flex: 1, backgroundColor: '#FFFFFF', marginHorizontal: 14, marginTop: 10, borderRadius: 18, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  webview: { flex: 1, backgroundColor: '#FFFFFF' },
  loadBar: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 10,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 5,
  },
  failBanner: {
    marginHorizontal: 14,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bannerButton: {
    minWidth: 50,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  webLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0F0B17',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  webLoadingText: { color: '#A99FBA', fontSize: 12 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12 },
  status: { color: '#C9C0DA', fontSize: 11.5, lineHeight: 16 },
  count: { color: '#7C728D', fontSize: 10, marginTop: 3 },
  importButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#7C5CFF', borderRadius: 14, height: 44, paddingHorizontal: 16 },
  importText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
});
