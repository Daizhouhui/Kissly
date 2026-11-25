import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

import { useAppStore } from '@/src/core/store';
import { Subscription } from '@/src/core/types';
import { resolveChannelInput } from '@/src/core/youtube/channel';
import { CONTINUOUS_CORNER, RADIUS } from '@/src/tokens';
import { AppPressable } from '@/src/ui/app-pressable';
import { useAppTheme } from '@/src/ui/theme';
import { normalizeYoutubeAvatarUrl } from '@/src/ui/youtube-avatar-url';

const Pressable = AppPressable;

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
      avatar:avatarOf(),
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
  function pageState(){
    var text='';
    try{ text=(document.body&&document.body.innerText||'').toLowerCase(); }catch(e){}
    var blocked = text.indexOf('disallowed_useragent')>=0 ||
      text.indexOf('此浏览器或应用可能不安全')>=0 ||
      text.indexOf('this browser or app may not be secure')>=0 ||
      text.indexOf('couldn\\'t sign you in')>=0 ||
      text.indexOf('无法登录')>=0;
    post({ type:'page', url:location.href, loggedIn:detectLogin(), blocked:blocked, avatar:avatarOf() });
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

function ImportAvatar({ uri, title }: { uri?: string; title: string }) {
  const theme = useAppTheme();
  const [failed, setFailed] = useState(false);
  if (!uri || failed) {
    return (
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: RADIUS.pill,
          backgroundColor: theme.colors.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: theme.colors.primary, fontSize: 15, fontWeight: '800' }}>
          {(title || '?').slice(0, 1).toUpperCase()}
        </Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={{ width: 42, height: 42, borderRadius: RADIUS.pill }}
      contentFit="cover"
      transition={120}
      onError={() => setFailed(true)}
    />
  );
}

export default function YoutubeAccountScreen() {
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const addSubscriptions = useAppStore((state) => state.addSubscriptions);
  const subscriptions = useAppStore((state) => state.subscriptions);
  const setYoutubeLoginStatus = useAppStore((state) => state.setYoutubeLoginStatus);
  const setYoutubeAvatar = useAppStore((state) => state.setYoutubeAvatar);
  const webRef = useRef<any>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedRef = useRef(false);
  const firstLoadRef = useRef(true);
  const [status, setStatus] = useState('请在上方网页中登录 YouTube 账号');
  const [progress, setProgress] = useState(0.06);
  const [progressVisible, setProgressVisible] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [loginChecked, setLoginChecked] = useState(false);
  const [failed, setFailed] = useState(false);
  const [lastCount, setLastCount] = useState<number | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewItems, setReviewItems] = useState<Subscription[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reviewNote, setReviewNote] = useState('');
  const existingIds = new Set(subscriptions.map((item) => item.channelId));
  const importableItems = reviewItems.filter((item) => !existingIds.has(item.channelId));

  const clearTimer = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  };

  const clearProgressHide = () => {
    if (progressHideRef.current) clearTimeout(progressHideRef.current);
    progressHideRef.current = null;
  };

  const beginLoad = () => {
    clearTimer();
    clearProgressHide();
    hasLoadedRef.current = false;
    setProgress(0.06);
    setProgressVisible(true);
    setFailed(false);
    setLoginChecked(false);
    timeoutRef.current = setTimeout(() => {
      // Never cover the WebView. Google's consent/login redirect chain can
      // legitimately take longer than 20 s on slow networks; hiding the page
      // behind an overlay made the previous build look "stuck forever".
      setProgressVisible(false);
      setFailed(true);
      setStatus('页面仍在加载。可以继续等待，或点下方按钮重试/改用浏览器。');
    }, 20000);
  };

  useEffect(() => {
    beginLoad();
    return () => {
      clearTimer();
      clearProgressHide();
    };
  }, []);

  const reload = () => {
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
    const uniqueResolved = Array.from(
      new Map(resolved.map((item) => [item.channelId, item])).values()
    );
    const suffix = failed > 0 ? `，${failed} 个未能识别账号` : '';
    setLastCount(uniqueResolved.length);
    if (uniqueResolved.length === 0) {
      setStatus(
        `没有读取到有效的 Channel ID（找到 ${raw.length} 个频道项${suffix}）。请重试或改用 CSV 导入。`
      );
      return;
    }
    const currentExisting = new Set(
      useAppStore.getState().subscriptions.map((item) => item.channelId)
    );
    setReviewItems(uniqueResolved);
    setSelectedIds(
      new Set(
        uniqueResolved
          .filter((item) => !currentExisting.has(item.channelId))
          .map((item) => item.channelId)
      )
    );
    setReviewNote(suffix);
    setReviewOpen(true);
    setStatus(`读取到 ${uniqueResolved.length} 个频道，请选择要导入的频道${suffix}。`);
  };

  const toggleReviewItem = (channelId: string) => {
    if (existingIds.has(channelId)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  };

  const toggleAllReviewItems = () => {
    if (selectedIds.size >= importableItems.length) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(importableItems.map((item) => item.channelId)));
  };

  const importSelectedChannels = () => {
    const currentExisting = new Set(
      useAppStore.getState().subscriptions.map((item) => item.channelId)
    );
    const chosen = reviewItems.filter(
      (item) => selectedIds.has(item.channelId) && !currentExisting.has(item.channelId)
    );
    if (!chosen.length) {
      setStatus('还没有选择要导入的频道。');
      return;
    }
    const before = useAppStore.getState().subscriptions.length;
    addSubscriptions(chosen);
    const after = useAppStore.getState().subscriptions.length;
    const added = Math.max(0, after - before);
    setReviewOpen(false);
    setStatus(
      `已导入 ${chosen.length} 个频道，新增 ${added} 个${reviewNote}。`
    );
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
      if (typeof message.loggedIn === 'boolean') {
        setLoggedIn(message.loggedIn);
        setLoginChecked(true);
        if (!message.blocked) {
          setYoutubeLoginStatus(message.loggedIn ? 'loggedIn' : 'loggedOut');
          if (message.loggedIn) {
            const avatar = normalizeYoutubeAvatarUrl(message.avatar);
            if (avatar) setYoutubeAvatar(avatar);
          } else {
            setYoutubeAvatar('');
          }
        }
      }
      if (message.blocked) {
        clearTimer();
        clearProgressHide();
        setProgressVisible(false);
        setFailed(true);
        setStatus('Google 拦截了应用内登录，请改用 CSV 导入订阅。');
      }
      return;
    }
    if (message?.type === 'channels') {
      clearTimer();
      if (typeof message.loggedIn === 'boolean') {
        setLoggedIn(message.loggedIn);
        setLoginChecked(true);
        setYoutubeLoginStatus(message.loggedIn ? 'loggedIn' : 'loggedOut');
        if (message.loggedIn) {
          const avatar = normalizeYoutubeAvatarUrl(message.avatar);
          if (avatar) setYoutubeAvatar(avatar);
        } else {
          setYoutubeAvatar('');
        }
      }
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
            {!loginChecked
              ? '正在检测登录状态…'
              : loggedIn
                ? '检测到:已登录'
                : '检测到:未登录'}
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

      <View style={styles.progressSlot} pointerEvents="none">
        {progressVisible ? (
          <View style={[styles.progressTrack, { backgroundColor: theme.colors.surfaceAlt }]}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.max(2, Math.min(100, Math.round(progress * 100)))}%`,
                  backgroundColor: theme.colors.primary,
                },
              ]}
            />
          </View>
        ) : null}
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
            if (!hasLoadedRef.current) {
              clearProgressHide();
              setProgress(0.06);
              setProgressVisible(true);
            }
            if (firstLoadRef.current) {
              firstLoadRef.current = false;
              beginLoad();
            }
          }}
          onLoadProgress={({ nativeEvent }: any) => {
            if (hasLoadedRef.current) return;
            const next = Number(nativeEvent?.progress);
            if (Number.isFinite(next)) {
              setProgress(Math.max(0.06, Math.min(0.98, next)));
            }
          }}
          onLoadEnd={() => {
            hasLoadedRef.current = true;
            clearTimer();
            clearProgressHide();
            setProgress(1);
            setProgressVisible(true);
            progressHideRef.current = setTimeout(() => setProgressVisible(false), 250);
            setFailed(false);
            firstLoadRef.current = false;
            setStatus((current) =>
              current.startsWith('页面仍在加载') || current.startsWith('正在打开')
                ? '请在上方网页中登录 YouTube 账号'
                : current
            );
            webRef.current?.injectJavaScript(CHANNEL_BRIDGE);
          }}
          onError={() => {
            clearTimer();
            clearProgressHide();
            setProgressVisible(false);
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
          <Pressable onPress={reload} tone="onColor" style={[styles.bannerButton, { backgroundColor: theme.colors.primary }]}>
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
          tone="onColor"
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

      <Modal
        visible={reviewOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setReviewOpen(false)}
      >
        <View style={styles.reviewMask}>
          <Pressable
            feedback="none"
            style={StyleSheet.absoluteFill}
            onPress={() => setReviewOpen(false)}
          />
          <View
            style={[
              styles.reviewSheet,
              {
                backgroundColor: theme.colors.card,
                paddingBottom: Math.max(16, insets.bottom),
              },
            ]}
          >
            <View style={styles.reviewHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.reviewTitle, { color: theme.colors.text }]}>
                  选择要导入的频道
                </Text>
                <Text style={[styles.reviewSubtitle, { color: theme.colors.textTertiary }]}>
                  {reviewItems.length} 个 · 已订阅 {reviewItems.length - importableItems.length} 个
                  {reviewNote}
                </Text>
              </View>
              <Pressable
                onPress={() => setReviewOpen(false)}
                hitSlop={8}
                style={[styles.reviewClose, { backgroundColor: theme.colors.surfaceAlt }]}
              >
                <Ionicons name="close" size={19} color={theme.colors.text} />
              </Pressable>
            </View>

            <View style={[styles.reviewToolbar, { borderColor: theme.colors.border }]}>
              <Text style={[styles.reviewSelected, { color: theme.colors.textSecondary }]}>
                已选 {selectedIds.size} 个
              </Text>
              {importableItems.length ? (
                <Pressable onPress={toggleAllReviewItems} hitSlop={8} feedback="opacity">
                  <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '700' }}>
                    {selectedIds.size >= importableItems.length ? '取消全选' : '全选'}
                  </Text>
                </Pressable>
              ) : (
                <Text style={{ color: theme.colors.textTertiary, fontSize: 12 }}>
                  全部已订阅
                </Text>
              )}
            </View>

            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingBottom: 4 }}
              showsVerticalScrollIndicator={false}
            >
              {reviewItems.map((item, index) => {
                const exists = existingIds.has(item.channelId);
                const selected = selectedIds.has(item.channelId);
                return (
                  <Pressable
                    key={`${item.channelId}-${index}`}
                    disabled={exists}
                    feedback="opacity"
                    radius={0}
                    onPress={() => toggleReviewItem(item.channelId)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 11,
                      paddingHorizontal: 16,
                      paddingVertical: 11,
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: theme.colors.border,
                      opacity: exists ? 0.55 : 1,
                    }}
                  >
                    <ImportAvatar uri={item.avatar} title={item.title} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        numberOfLines={1}
                        style={{ color: theme.colors.text, fontSize: 13.5, fontWeight: '700' }}
                      >
                        {item.title}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 2 }}
                      >
                        {item.handle || item.channelId}
                      </Text>
                    </View>
                    {exists ? (
                      <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>
                        已订阅
                      </Text>
                    ) : (
                      <Ionicons
                        name={selected ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={selected ? theme.colors.primary : theme.colors.textTertiary}
                      />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={[styles.reviewFooter, { borderColor: theme.colors.border }]}>
              <Pressable
                onPress={() => setReviewOpen(false)}
                style={[styles.reviewCancel, { backgroundColor: theme.colors.surfaceAlt }]}
              >
                <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '700' }}>
                  取消
                </Text>
              </Pressable>
              <Pressable
                disabled={selectedIds.size === 0}
                tone="onColor"
                onPress={importSelectedChannels}
                style={[
                  styles.reviewImport,
                  { backgroundColor: theme.colors.primary },
                  selectedIds.size === 0 && { opacity: 0.45 },
                ]}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800' }}>
                  {selectedIds.size ? `导入 ${selectedIds.size} 个` : '导入选中'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0812' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingBottom: 10 },
  iconButton: { width: 40, height: 40, borderRadius: RADIUS.pill, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#F5F2FF', fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { color: '#8D849D', fontSize: 11, marginTop: 2 },
  avatar: { width: 36, height: 36, borderRadius: RADIUS.pill, backgroundColor: 'rgba(124,92,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  avatarOn: { backgroundColor: '#2FB980' },
  progressSlot: { height: 2, marginTop: 8, marginHorizontal: 16 },
  progressTrack: { flex: 1, height: 2, borderRadius: 1, overflow: 'hidden' },
  progressFill: { height: 2, borderRadius: 1 },
  webCard: { flex: 1, backgroundColor: '#FFFFFF', marginHorizontal: 14, marginTop: 8, borderRadius: RADIUS.card, ...CONTINUOUS_CORNER, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  webview: { flex: 1, backgroundColor: '#FFFFFF' },
  failBanner: {
    marginHorizontal: 14,
    marginTop: 10,
    borderRadius: RADIUS.card,
    ...CONTINUOUS_CORNER,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bannerButton: {
    minWidth: 50,
    height: 32,
    borderRadius: RADIUS.control,
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
  importButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#7C5CFF', borderRadius: RADIUS.control, height: 44, paddingHorizontal: 16 },
  importText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  reviewMask: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  reviewSheet: {
    width: '100%',
    maxHeight: '88%',
    borderTopLeftRadius: RADIUS.modal,
    borderTopRightRadius: RADIUS.modal,
    ...CONTINUOUS_CORNER,
    paddingTop: 14,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  reviewTitle: { fontSize: 17, fontWeight: '800' },
  reviewSubtitle: { fontSize: 11, lineHeight: 16, marginTop: 3 },
  reviewClose: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  reviewSelected: { fontSize: 12 },
  reviewFooter: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  reviewCancel: {
    width: 88,
    height: 44,
    borderRadius: RADIUS.control,
    ...CONTINUOUS_CORNER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewImport: {
    flex: 1,
    height: 44,
    borderRadius: RADIUS.control,
    ...CONTINUOUS_CORNER,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
