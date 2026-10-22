export const orbPreviewGuard = `<script>
window.__VG_PREVIEW_GUARD__={networkAttempts:0,mediaAttempts:0,audioAttempts:0};
window.fetch=async()=>{window.__VG_PREVIEW_GUARD__.networkAttempts++;throw new Error('isolated-preview:network-disabled');};
if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{window.__VG_PREVIEW_GUARD__.mediaAttempts++;throw new DOMException('Isolated preview has no microphone','NotAllowedError');}});
for(const name of ['SpeechRecognition','webkitSpeechRecognition'])if(window[name])window[name].prototype.start=function(){window.__VG_PREVIEW_GUARD__.mediaAttempts++;throw new Error('isolated-preview:microphone-disabled');};
if(window.speechSynthesis)window.speechSynthesis.speak=()=>{window.__VG_PREVIEW_GUARD__.audioAttempts++;throw new Error('isolated-preview:audio-disabled');};
</script>`;
