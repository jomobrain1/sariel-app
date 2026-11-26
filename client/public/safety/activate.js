import { landscape } from './landscape.js';

const style=document.createElement('link');
style.rel='stylesheet';style.href='/safety/gallery.css';document.head.append(style);
const root=document.querySelector('#root');
root.innerHTML='<h1>Landscape collection</h1><figure aria-label="Featured landscape"></figure><section aria-label="Explore landscapes"></section><dialog aria-label="Landscape print"><div></div><button type="button">Close</button></dialog>';
const figure=root.querySelector('figure'), dialog=root.querySelector('dialog');
const practice=location.pathname==='/safety/activate.html' && location.search==='?practice=1';
const token=location.pathname.match(/^\/([a-z][a-z0-9]{1,12}[0-9]|[A-Za-z0-9_-]{16})\/?$/)?.[1] || location.hash.slice(1);
let edition, cover, busy=false;
const pending=[];
function show(scene){
  if(scene===cover)return;
  cover=scene;
  figure.replaceChildren(landscape(scene));
  figure.setAttribute('aria-label',{valley:'Green valley',sunrise:'Golden sunrise',harbor:'Sailboat in the harbor'}[scene]);
}
show('valley');
async function post(path,body){
  return fetch('/api/auth/safety/'+path,{method:'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,...body})});
}
async function sync(){
  if(practice || !token || busy || document.visibilityState!=='visible' || document.prerendering)return;
  busy=true;
  try{
    if(!edition){
      const activation=await post('activate',{gallery:true});
      if(!activation.ok)return;
      edition=(await activation.json()).data.edition;
      if(!edition)return;
    }
    const response=await post('gallery',{});
    if(!response.ok){if(response.status===403)show('valley');return;}
    const {data}=await response.json();
    if(data.edition!==edition){show('valley');pending.length=0;return;}
    show(data.cover);
    while(pending.length){
      const result=await post('gallery/select',{edition,...pending[0]});
      if(!result.ok)return;
      pending.shift();
    }
  }catch{/* Retry with the same request IDs while this page remains open. */}
  finally{busy=false;}
}
for(const [image,label] of Object.entries({road:'Country road',bridge:'River bridge',mountain:'Mountain peak'})){
  const button=document.createElement('button'),caption=document.createElement('span');
  caption.textContent=label;button.append(landscape(image),caption);
  button.onclick=()=>{
    dialog.querySelector('div').replaceChildren(landscape(image));dialog.showModal();
    if(!practice){pending.push({image,requestId:crypto.randomUUID()});void sync();}
  };
  root.querySelector('section').append(button);
}
dialog.querySelector('button').onclick=()=>dialog.close();
if(practice){
  const select=document.createElement('select');
  select.setAttribute('aria-label','Practice cover');
  for(const [scene,title] of Object.entries({valley:'Original cover',sunrise:'Acknowledged',harbor:'Dispatch confirmed'}))select.add(new Option(title,scene));
  select.onchange=()=>show(select.value);root.append(select);
}else{
  document.addEventListener('visibilitychange',sync);
  document.addEventListener('prerenderingchange',sync);
  setInterval(sync,15000);void sync();
}
