(() => {
'use strict';
const foods=[
  {
    "id": "poppies",
    "title": "Poppies · Spitalfields",
    "cat": "Yemek",
    "icon": "🍽️",
    "dish": "Fish & chips",
    "area": "Spitalfields / Brick Lane",
    "desc": "Çıtır balık, patates ve geleneksel fish & chips deneyimi.",
    "tip": "Doğu Londra rotasıyla eşleştirin. Çocuk porsiyonu ve alerjen bilgisi menüde; 7 kişi ve Noel saatleri teyit edilmeli.",
    "url": "https://poppiesfishandchips.co.uk/locations/",
    "place": "Poppies Fish and Chips Spitalfields London",
    "slot": "Öğle",
    "duration": 75,
    "photo": "poppies",
    "status": "Menü / mekân doğrulandı · Noel saatleri teyit",
    "date": "19–24 Aralık için aday",
    "price": "Güncel menüden teyit · 7 kişilik masa ve Noel tarifesi ayrıca kontrol"
  },
  {
    "id": "mash",
    "title": "Mother Mash · Carnaby",
    "cat": "Yemek",
    "icon": "🍽️",
    "dish": "Pie & mash / bangers & mash",
    "area": "Soho / Carnaby",
    "desc": "İngiliz turtası veya sosis, patates püresi ve gravy.",
    "tip": "Carnaby ışıkları veya Hamleys sonrasında sıcak öğün. Et içeriği ve sosları menüden kontrol edin; 7 kişilik masa müsaitliği teyit.",
    "url": "https://www.mothermash.co.uk/menu",
    "place": "Mother Mash 26 Ganton Street London",
    "slot": "Akşam",
    "duration": 75,
    "photo": "mash",
    "status": "Menü / mekân doğrulandı · Noel saatleri teyit",
    "date": "19–24 Aralık için aday",
    "price": "Güncel menüden teyit · 7 kişilik masa ve Noel tarifesi ayrıca kontrol"
  },
  {
    "id": "hawksmoor",
    "title": "Hawksmoor · Seven Dials",
    "cat": "Yemek",
    "icon": "🍽️",
    "dish": "Sunday roast + Yorkshire pudding",
    "area": "Covent Garden",
    "desc": "Pazar gününe klasik fırın et, garnitürler ve Yorkshire pudding.",
    "tip": "20 Aralık pazar ve Nergis’in doğum günü için yemek adayı. Roast servis saatini ve 7 kişilik masayı kontrol edin; menü seçimi yapılmış değil.",
    "url": "https://thehawksmoor.com/locations/seven-dials/",
    "place": "Hawksmoor Seven Dials London",
    "slot": "Öğle",
    "duration": 100,
    "photo": "hawksmoor",
    "status": "Menü / mekân doğrulandı · Noel saatleri teyit",
    "date": "19–24 Aralık için aday",
    "price": "Güncel menüden teyit · 7 kişilik masa ve Noel tarifesi ayrıca kontrol"
  },
  {
    "id": "tea",
    "title": "Fortnum & Mason · Tea Salon",
    "cat": "Yemek",
    "icon": "🍽️",
    "dish": "Afternoon tea + scone",
    "area": "Piccadilly / St James’s",
    "desc": "Çay, küçük sandviçler, tatlılar; scone, reçel ve clotted cream.",
    "tip": "Çocuk menüsü var. Yedi kişilik grup, doğum günü pastası ve özel beslenmeyi doğrudan teyit edin. Ayrı bir öğün gibi planlayın; hızlı kafe molası değil.",
    "url": "https://www.fortnumandmason.com/diamond-jubilee-tea-salon",
    "place": "Fortnum Mason Diamond Jubilee Tea Salon 181 Piccadilly London",
    "slot": "Çay molası",
    "duration": 100,
    "photo": "tea",
    "status": "Menü / mekân doğrulandı · Noel saatleri teyit",
    "date": "19–24 Aralık için aday",
    "price": "Güncel menüden teyit · 7 kişilik masa ve Noel tarifesi ayrıca kontrol"
  },
  {
    "id": "dishoom",
    "title": "Dishoom · Covent Garden",
    "cat": "Yemek",
    "icon": "🍽️",
    "dish": "Naan roll & chai / Bombay mutfağı",
    "area": "Covent Garden",
    "desc": "Londra’nın çok kültürlü yemek sahnesinden naan kahvaltısı ve chai.",
    "tip": "İngiliz klasiği değil, Londra deneyimi. Kahvaltı ve çocuk menüsü resmî sitede. 7 kişi için rezervasyon veya kuyruk koşulunu teyit edin.",
    "url": "https://www.dishoom.com/covent-garden/",
    "place": "Dishoom Covent Garden London",
    "slot": "Kahvaltı",
    "duration": 75,
    "photo": "dishoom",
    "status": "Menü / mekân doğrulandı · Noel saatleri teyit",
    "date": "19–24 Aralık için aday",
    "price": "Güncel menüden teyit · 7 kişilik masa ve Noel tarifesi ayrıca kontrol"
  },
  {
    "id": "beigel",
    "title": "Beigel Bake · 159 Brick Lane",
    "cat": "Yemek",
    "icon": "🍽️",
    "dish": "Salt beef beigel",
    "area": "Brick Lane",
    "desc": "Doğu Londra’da hızlı bir beigel molası; salt beef klasik seçenek.",
    "tip": "159 Brick Lane’deki dükkânı seçin. Hızlı servis; 7 kişilik oturmalı restoran gibi planlamayın. Hardal/turşu ve çocuklara uygun içeriği sorun.",
    "url": "https://www.beigelbake.co.uk/",
    "place": "Beigel Bake 159 Brick Lane London",
    "slot": "Atıştırmalık",
    "duration": 30,
    "photo": "beigel",
    "status": "Menü / mekân doğrulandı · Noel saatleri teyit",
    "date": "19–24 Aralık için aday",
    "price": "Güncel menüden teyit · 7 kişilik masa ve Noel tarifesi ayrıca kontrol"
  },
  {
    "id": "bread",
    "title": "Bread Ahead · Borough Market",
    "cat": "Yemek",
    "icon": "🍽️",
    "dish": "Doughnut & kahve",
    "area": "Borough / London Bridge",
    "desc": "Dolgulu doughnut ile tatlı molası.",
    "tip": "Tower çevresindeki rotaya alternatif mola. Noel açılışı ve günlük ürünleri teyit edin; pasta rezervasyonu veya belirli çeşidin stoğu garanti değil.",
    "url": "https://www.breadahead.com/borough",
    "place": "Bread Ahead Borough Market London",
    "slot": "Tatlı molası",
    "duration": 30,
    "photo": "bread",
    "status": "Menü / mekân doğrulandı · Noel saatleri teyit",
    "date": "19–24 Aralık için aday",
    "price": "Güncel menüden teyit · 7 kişilik masa ve Noel tarifesi ayrıca kontrol"
  },
  {
    "id": "wolseley",
    "title": "The Wolseley · Piccadilly",
    "cat": "Yemek",
    "icon": "🍽️",
    "dish": "Full English breakfast",
    "area": "Piccadilly",
    "desc": "Klasik İngiliz kahvaltısını tarihî salonda deneyimleme adayı.",
    "tip": "Önemli grup sınırı: resmî FAQ normal en büyük masayı 6 kişi olarak belirtiyor. 7 kişi için özel yemek/grup düzeniyle doğrudan teyit şart; standart masa var kabul etmeyin.",
    "url": "https://www.thewolseleypiccadilly.com/faqs/",
    "place": "The Wolseley Piccadilly London",
    "slot": "Kahvaltı",
    "duration": 90,
    "photo": "wolseley",
    "status": "Menü / mekân doğrulandı · Noel saatleri teyit",
    "date": "19–24 Aralık için aday",
    "price": "Güncel menüden teyit · 7 kişilik masa ve Noel tarifesi ayrıca kontrol"
  },
  {
    "id": "sevendials",
    "title": "Seven Dials Market",
    "cat": "Yemek",
    "icon": "🍽️",
    "dish": "Sokak lezzetleri · farklı seçenekler",
    "area": "Covent Garden",
    "desc": "Aile bireyleri farklı tezgâhlardan yemek seçebilir.",
    "tip": "Tek bir ikonik İngiliz yemeği değil; esnek öğün alternatifi. Kalabalıkta 7 kişinin birlikte oturması garanti değil; Noel saatleri ve çocuk koşulları teyit.",
    "url": "https://www.sevendialsmarket.com/visit-us/",
    "place": "Seven Dials Market London",
    "slot": "Öğle",
    "duration": 60,
    "photo": "sevendials",
    "status": "Menü / mekân doğrulandı · Noel saatleri teyit",
    "date": "19–24 Aralık için aday",
    "price": "Güncel menüden teyit · 7 kişilik masa ve Noel tarifesi ayrıca kontrol"
  }
];
const photos={"winter": {"path": "assets/winter.jpg", "page": "https://hydeparkwinterwonderland.com/hyde-park/", "image": "https://d1kgj8r9rzpmlp.cloudfront.net/wp-content/uploads/2026/10/05224114/Winter-Wonderland_28th-November-2024_Joshua-Atkins-40-Web-1200x800.jpeg", "bytes": 192927}, "polar": {"path": "assets/polar.png", "page": "https://londonthepolarexpressride.com/", "image": "https://londonthepolarexpressride.com/wp-content/uploads/2026/01/Untitled-6.png", "bytes": 626763}, "nhm": {"path": "assets/nhm.jpg", "page": "https://www.nhm.ac.uk/visit.html", "image": "https://www.nhm.ac.uk/content/dam/nhm-www/home/2025-new-home-page-test/resized-fern-for-homepage-desktop.jpg", "bytes": 461208}, "somerset": {"path": "assets/somerset.jpg", "page": "https://www.somersethouse.org.uk/whats-on/skate-somerset-house", "image": "https://admin.somersethouse.org.uk/images/sVbxorOige8YoaQx29zH3KFi4gI=/6862/width-600/Skate-HEADER-DAYTIME.jpg", "bytes": 86105}, "mash": {"path": "assets/mash.jpg", "page": "https://www.mothermash.co.uk/", "image": "https://framerusercontent.com/assets/vn6X14wNHYSk4ToxeBgja2aI.jpg", "bytes": 794375}, "dishoom": {"path": "assets/dishoom.jpg", "page": "https://www.dishoom.com/covent-garden/", "image": "https://cdn.sanity.io/images/daku84np/production/b492504165ed7b5327abddaf1086b7a099f65418-1200x797.jpg?rect=0,86,1200,627&w=1200&h=627&fit=crop&auto=format", "bytes": 112574}, "beigel": {"path": "assets/beigel.jpg", "page": "https://www.beigelbake.co.uk/", "image": "http://www.beigelbake.co.uk/cdn/shop/files/beigel-bake-top-sm.jpg?v=1728656554", "bytes": 153159}, "bread": {"path": "assets/bread.jpg", "page": "https://www.breadahead.com/borough", "image": "https://www.breadahead.com/wp-content/uploads/cropped-Bread-Ahead-Bakery-Borough-Market.jpeg", "bytes": 80586}, "hawksmoor": {"path": "assets/hawksmoor.jpg", "page": "https://thehawksmoor.com/locations/seven-dials/", "image": "https://thehawksmoor.com/wp-content/uploads/2022/03/seven-dials-04-X3.jpeg", "bytes": 673003}};
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const days=['19','20','21','22','23','24'];
const weekdays=['Cumartesi','Pazar','Pazartesi','Salı','Çarşamba','Perşembe'];
const modes={transit:'Toplu taşıma',walking:'Yürüyüş',driving:'Araç / taksi'};
const statuses={'todo':'Bilet / masa kontrolü','requested':'Talep iletildi · yanıt bekleniyor','booked':'Onay alındı','free':'Bilet / rezervasyon gerekmiyor'};
const durations={winter:150,kew:120,alice:120,polar:100,epping:150,raf:210,brook:300,dux:360,nhm:150,science:150,harry:300};
const slotTimes={'Kahvaltı':'09:00','Öğle':'12:30','Akşam':'18:00','Çay molası':'15:00','Tatlı molası':'15:30','Atıştırmalık':'11:30'};
const catalog=[...activities.map(a=>({...a,kind:'activity',duration:durations[a.id]||90})),...foods.map(a=>({...a,kind:'food'}))];
const byId=id=>catalog.find(a=>a.id===id);
const storageKey='flyfam-london-2026-planner-v2';
const blank=()=>({version:2,days:Object.fromEntries(days.map(d=>[d,[]])),flights:[],hotels:[],savedAt:null});
const clone=o=>JSON.parse(JSON.stringify(o));
let saved=blank(),storageOK=true;
function cleanPlan(raw){
 if(!raw||raw.version!==2||!raw.days||typeof raw.days!=='object')throw Error('Geçersiz plan');
 const out=blank(),ids=new Set();
 for(const d of days){if(!Array.isArray(raw.days[d]))throw Error('Geçersiz gün');out.days[d]=raw.days[d].slice(0,35).map(x=>{if(!x||typeof x!=='object')throw Error();const uid=typeof x.uid==='string'&&!ids.has(x.uid)?x.uid:crypto.randomUUID();ids.add(uid);return {uid,item:typeof x.item==='string'&&byId(x.item)?x.item:'custom',title:String(x.title||'Özel durak').slice(0,150),place:String(x.place||'').slice(0,250),time:/^\d{2}:\d{2}$/.test(x.time)?x.time:'',duration:Math.max(0,Math.min(1440,Number(x.duration)||0)),group:['all','gani','serkan'].includes(x.group)?x.group:'all',status:statuses[x.status]?x.status:'todo',note:String(x.note||'').slice(0,1500),cost:x.cost===''?'':String(Math.max(0,Math.min(1000000,Number(x.cost)||0))),mode:modes[x.mode]?x.mode:'transit',travel:Math.max(0,Math.min(1440,Number(x.travel)||0)),transferStatus:['todo','ready'].includes(x.transferStatus)?x.transferStatus:'todo'}})}
 for(const kind of ['flights','hotels']){out[kind]=(Array.isArray(raw[kind])?raw[kind]:[]).slice(0,12).map(x=>Object.fromEntries(Object.entries(x||{}).filter(([k])=>['uid','family','direction','number','from','to','date','depart','arrive','terminal','name','address','checkin','checkout','status'].includes(k)).map(([k,v])=>[k,String(v).slice(0,300)])))}
 out.savedAt=typeof raw.savedAt==='string'?raw.savedAt:null;return out;
}
try{const p=JSON.parse(localStorage.getItem(storageKey)||'null');if(p)saved=cleanPlan(p)}catch(e){storageOK=false}
let draft=clone(saved),currentDay='19',activeTab='plan',activePhotoStop='',category='Hepsi',foodCategory='Hepsi',search='',foodSearch='',favOnly=false,verification='all';
let toastTimer;
function toast(t){$('toast').textContent=t;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000)}
const equal=(a,b)=>JSON.stringify({...a,savedAt:null})===JSON.stringify({...b,savedAt:null});
function dirty(){return !equal(draft,saved)}
function count(){return days.reduce((n,d)=>n+draft.days[d].length,0)}
function updateSave(){const changed=dirty();$('savebar').classList.toggle('dirty',changed);$('saveHeading').textContent=changed?'Kaydedilmemiş değişiklikler var':saved.savedAt?'Planınız kaydedildi':'Planınızı oluşturmaya başlayın';$('saveDetail').textContent=!storageOK?'Tarayıcı saklaması kullanılamıyor; planı indirin.':changed?'Kaydet ile bu cihazdaki programı güncelleyin.':saved.savedAt?'Son kayıt: '+new Date(saved.savedAt).toLocaleString('tr-TR')+' · bu cihaz':'Seçimler boş başlar; öneriler otomatik eklenmez.';if($('planCounter'))$('planCounter').textContent=count()+' durak';}
function persist(){const next=clone(draft);next.savedAt=new Date().toISOString();try{localStorage.setItem(storageKey,JSON.stringify(next));saved=next;draft=clone(saved);storageOK=true;updateSave();toast('Plan kaydedildi. Günlük programınız hazır.')}catch(e){storageOK=false;updateSave();toast('Cihaza kaydedilemedi. Planı indirerek saklayın.')}}
const image=a=>photos[a.photo||a.id];
function photo(a,cls='photo'){const p=image(a);return p?'<img class="'+cls+'" src="'+esc(p.path)+'" alt="'+esc(a.title)+' · resmî tanıtım görseli" loading="lazy" width="600" height="400">':cls==='photo'?'<div class="photo-fallback" aria-label="Bu durak için fotoğraf eklenmedi">'+a.icon+'</div>':''}
const maps=q=>'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(q);
function directions(origin,dest,mode='transit'){return 'https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(origin)+'&destination='+encodeURIComponent(dest)+'&travelmode='+mode}
function link(url,text){return '<a href="'+esc(url)+'" target="_blank" rel="noopener">'+text+' ↗</a>'}
function itemFor(stop){return byId(stop.item)||{title:stop.title,place:stop.place,icon:'📍',kind:'custom',url:'',tip:''}}
function stopTitle(s){return itemFor(s).title}
function stopPlace(s){return s.place||itemFor(s).place||''}
function hotelFor(group='all'){return draft.hotels.find(h=>h.address&&(h.family===group||h.family==='all'))||draft.hotels.find(h=>h.address)}
function dayLabel(d){return d+' Aralık '+weekdays[days.indexOf(d)]}
function options(values,selected){return Object.entries(values).map(([v,t])=>'<option value="'+esc(v)+'"'+(v===String(selected)?' selected':'')+'>'+esc(t)+'</option>').join('')}
function field(label,html){return '<label class="field">'+label+html+'</label>'}
function input(name,value,type='text',extra=''){return '<input data-field="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extra+'>'}
function select(name,values,val){return '<select data-field="'+name+'">'+options(values,val)+'</select>'}
function dayButtons(){return '<div class="daytabs">'+days.map((d,i)=>'<button data-day="'+d+'" aria-pressed="'+(d===currentDay)+'"><strong>'+d+' Ara</strong><small>'+weekdays[i]+(d==='20'?' · 🎂 Nergis 4':d==='21'?' · 🎂 Oben 5':'')+'</small><small>'+draft.days[d].length+' durak</small></button>').join('')+'</div>'}
function notice(s,d){const a=itemFor(s),notes=[];const day=Number(d);if(a.id==='nhm'&&d==='24')notes.push('24 Aralık’ta NHM kapalı. Başka güne taşıyın.');if(a.id==='polar'&&d==='24')notes.push('Polar Express’in resmî listesinde 24 Aralık yok. 19–23 Aralık’tan seçin.');if(a.id==='nut'){notes.push('Nergis 4 yaşında: Aralık Nutcracker seansları 5 yaş altına açık değil.');if(day<21)notes.push('Oben 21 Aralık’tan önce henüz 4 yaşında.');if(d==='21')notes.push('Resmî Nutcracker listesinde 21 Aralık seansı yok.')}if(a.id==='alice')notes.push('Cirque Alice 5+ öneriyor. Nergis seyahatte 3→4; Oben 21 Aralık’tan önce 4. Mekânla uygunluğu teyit edin.');if(a.id==='porto'&&d!=='19')notes.push('Portobello’nun ana antika günü cumartesi; bu gezide 19 Aralık.');if(a.id==='jubilee'&&d!=='21')notes.push('Jubilee antika günü pazartesi; bu gezide 21 Aralık.');if(a.id==='hawksmoor'&&d!=='20')notes.push('Sunday roast için bu gezide pazar 20 Aralık. Diğer günlerde normal menüyü kontrol edin.');if(a.id==='wolseley')notes.push('7 kişi için standart tek masa teyitli değil; resmî normal masa sınırı 6.');if(a.status==='2026 teyit bekliyor')notes.push('2026 tarih / seans teyidi henüz yok.');return notes}
function timeM(t){return t?Number(t.slice(0,2))*60+Number(t.slice(3)):null}
function warningDay(d){const list=draft.days[d],warnings=[];for(let i=1;i<list.length;i++){const prev=list[i-1],cur=list[i],p=timeM(prev.time),c=timeM(cur.time);if(p!==null&&c!==null&&p+prev.duration+cur.travel>c)warnings.push(stopTitle(prev)+' ile '+stopTitle(cur)+' arasında süre çakışması var.')}if(list.reduce((n,s)=>n+s.duration+s.travel,0)>480)warnings.push('Toplam aktivite + girilen yol süreleri 8 saati aşıyor; çocuklar için molaları gözden geçirin.');return warnings}
function renderLeg(s,prev,d){const origin=prev?stopPlace(prev):hotelFor(s.group)?.address,dest=stopPlace(s);return '<div class="leg" data-uid="'+s.uid+'"><strong>↳ '+(prev?esc(stopTitle(prev)):'Otelden'+(hotelFor(s.group)?' · '+esc(hotelFor(s.group).name||hotelFor(s.group).address):''))+' → sonraki durak</strong><div style="margin:7px 0"><label>Ulaşım '+select('mode',modes,s.mode)+'</label><label>Pay (dk) '+input('travel',s.travel||'','number','min="0" max="1440" placeholder="Teyit"')+'</label></div>'+(origin&&dest?link(directions(origin,dest,s.mode),'Rotayı ve süreyi kontrol et'):'<small>Başlangıç için Uçuş & Otel sekmesinde otel adresi girin.</small>')+' <small>Canlı süre hesaplanmaz; yol payını rotaya bakarak girin.</small></div>'}
function renderStop(s,d,index,print=false){const a=itemFor(s),warnings=notice(s,d),list=draft.days[d];return '<article class="plan-stop" data-uid="'+s.uid+'"><div class="stop-top">'+photo(a,'stop-thumb')+'<div class="stop-copy"><h3>'+esc(a.title)+'</h3><small>'+esc(s.time||'Saat seçilmedi')+' · '+s.duration+' dk · '+(s.group==='all'?'7 kişi':s.group==='gani'?'Gani ailesi · 3 kişi':'Serkan ailesi · 4 kişi')+'</small><small>'+esc(statuses[s.status])+'</small></div>'+(print?'':'<button class="move" data-action="up" aria-label="'+esc(a.title)+' yukarı taşı" '+(index===0?'disabled':'')+'>↑</button><button class="move" data-action="down" aria-label="'+esc(a.title)+' aşağı taşı" '+(index===list.length-1?'disabled':'')+'>↓</button>')+'</div>'+warnings.map(w=>'<p class="warning">'+esc(w)+'</p>').join('')+'<div class="stop-fields">'+field('Başlangıç',input('time',s.time,'time'))+field('Süre (dk)',input('duration',s.duration,'number','min="0" max="1440"'))+field('Kimler?',select('group',{all:'Herkes · 7 kişi',gani:'Gani · Mine · Oben',serkan:'Serkan · Melis · Aziz · Nergis'},s.group))+field('Bilet / masa',select('status',statuses,s.status))+field('Gün',select('day',Object.fromEntries(days.map(d=>[d,dayLabel(d)])),d))+field('Toplam GBP · isteğe bağlı',input('cost',s.cost,'number','min="0" step="0.01"'))+'</div><div class="stop-links">'+(a.url?link(a.url,a.kind==='food'?'Menü / masa rezervasyonu':'Resmî site / bilet'):'')+(stopPlace(s)?link(maps(stopPlace(s)),'Haritada gör'):'')+'<button data-action="remove" style="font-size:12px;padding:3px 10px">Plandan çıkar</button></div><details class="stop-details"><summary>Plan notu & adres</summary><div class="stop-fields">'+field('Adres / harita araması',input('place',s.place||a.place||''))+field('Rezervasyon / plan notu',input('note',s.note,'text','placeholder="Örn. çocuk menüsü sorulacak"'))+'</div><p class="source-note">PNR, ödeme bilgisi veya özel belge numarası yazmayın. Durum seçmek rezervasyon oluşturmaz.</p></details></article>'}
function renderDay(d,print=false){const list=draft.days[d];return (d==='20'?'<div class="banner red"><strong>🎂 Nergis’in 4. doğum günü</strong><p>Pasta ve aile yemeği için rahat bir zaman bırakın.</p></div>':d==='21'?'<div class="banner red"><strong>🎂 Oben’in 5. doğum günü</strong><p>Bir ana deneyim ve dinlenme; pasta saatini trenin hemen sonrasına sıkıştırmayın.</p></div>':'')+warningDay(d).map(w=>'<p class="warning" style="margin:12px 0">'+esc(w)+'</p>').join('')+(list.length?list.map((s,i)=>(print?'':renderLeg(s,list[i-1],d))+renderStop(s,d,i,print)).join(''):'<div class="plan-empty"><div class="emoji">🧳</div><h3>Bu gün sizin seçimlerinizi bekliyor.</h3><p>Aktivite veya yemek seçin; gün, saat ve sırayı burada düzenleyin.</p><div class="panel-actions" style="justify-content:center"><button class="secondary" data-goto="catalog">Aktivite seç</button><button data-goto="food">Yemek seç</button></div></div>')}
function renderPlan(){const p=$('planner');p.innerHTML='<div class="eyebrow">Sizin seyahatiniz, sizin programınız</div><div class="panel-actions noprint"><button data-backup>↓ Kaydedilen planı paylaş / yedekle</button><button data-import-plan>↑ Plan dosyası yükle</button><button data-print-plan>🖨 Günlük planı yazdır</button></div><p class="source-note noprint">Bu cihazda saklanır. Diğer aileye aynı planı aktarmak için yedeği paylaşın; otomatik eşitleme yoktur.</p><div class="planner-toolbar"><div><h2>Gün gün Londra.</h2><p class="muted">Seç → gününe ekle → saatini düzenle → kaydet.</p></div><span id="planCounter" class="count-pill">'+count()+' durak</span></div>'+dayButtons()+'<div class="current-plan plan-layout"><div><h3>'+dayLabel(currentDay)+'</h3><div id="dayStops">'+renderDay(currentDay)+'</div><details class="box"><summary>+ Kendi durağını ekle</summary><p class="muted">Pasta molası, dinlenme, transfer veya listede olmayan bir yer.</p><form id="customForm" class="custom-grid"><input name="title" placeholder="Durak adı" aria-label="Durak adı" required maxlength="150"><input name="time" type="time" aria-label="Durak saati"><input name="duration" type="number" min="0" max="1440" value="60" aria-label="Durak süresi dakika"><input class="wide" name="place" placeholder="Adres / yer adı (isteğe bağlı)" aria-label="Durak adresi"><button class="primary" type="submit">Güne ekle</button></form></details></div><aside class="plan-aside"><div class="card"><div class="eyebrow">Plan özeti</div><h3>'+dayLabel(currentDay)+'</h3><p>'+draft.days[currentDay].length+' durak · '+draft.days[currentDay].reduce((n,s)=>n+s.duration,0)+' dk aktivite</p><p class="muted">Girilen yol payı: '+draft.days[currentDay].reduce((n,s)=>n+s.travel,0)+' dk</p><p class="muted">Girilen tutarlar toplamı: £'+draft.days[currentDay].reduce((n,s)=>n+(Number(s.cost)||0),0).toFixed(2)+'<br>Bu tutar tüm seyahatin maliyeti değildir.</p><button class="secondary" data-goto="map">Günün haritasını aç</button><p class="source-note">Saatler Londra yerel saati. Aralıkta Türkiye Londra’dan 3 saat ileride.</p></div><div class="card" style="margin-top:15px"><h3>Bir sonraki adım</h3><p>Otel ve uçuşları girin; ardından seçilen durakların bilet, masa ve ulaşım işlerini kontrol edin.</p><div class="panel-actions"><button data-goto="trip">Uçuş & Otel</button><button data-goto="bookings">Bilet & rezervasyon</button></div></div></aside></div><div class="all-days">'+days.map(d=>'<div class="plan-printed-day"><h3>'+dayLabel(d)+'</h3>'+renderDay(d,true)+'</div>').join('')+'</div>';updateSave()}
function newStop(item,time=''){return {uid:crypto.randomUUID(),item:item.id,title:item.title,place:item.place||'',time:time||slotTimes[item.slot]||'',duration:item.duration||90,group:'all',status:'todo',note:'',cost:'',mode:'transit',travel:0,transferStatus:'todo'}}
function addItem(id,d){if(draft.days[d].some(s=>s.item===id)){toast('Bu durak bu günde zaten var. Planım sekmesinden düzenleyin.');return}if(draft.days[d].length>=35){toast('Bu gün için en fazla 35 durak eklenebilir.');return}draft.days[d].push(newStop(byId(id)));currentDay=d;updateSave();toast(dayLabel(d)+' taslağına eklendi. Planı kaydetmeyi unutmayın.');renderCatalog(activeTab==='food');renderPlan()}
function renderCatalog(food=false){const arr=food?foods:activities,filter=food?foodCategory:category,q=(food?foodSearch:search).toLocaleLowerCase('tr'),id=food?'food':'catalog';const categories=['Hepsi',...new Set(arr.map(a=>food?a.slot:a.cat))];const found=arr.filter(a=>(filter==='Hepsi'||(food?a.slot:a.cat)===filter)&&Object.values(a).join(' ').toLocaleLowerCase('tr').includes(q)&&(!favOnly||state.favorites.includes(a.id))&&(food||verification==='all'||(verification==='confirmed'?a.status==='2026 doğrulandı':a.status!=='2026 doğrulandı')));$(id).innerHTML='<div class="eyebrow">'+(food?'Londra’nın tadı':'Keşfet & seç')+'</div><h2>'+(food?'Biraz da lezzet katalım.':'Hangi anılarla dönelim?')+'</h2><p class="muted">'+(food?'Fish & chips, pie & mash, Sunday roast, afternoon tea ve Londra’dan farklı tatlar. Menü / mekân kontrolü: 18 Ekim 2026; Noel saatleri ve 7 kişilik yer ayrıca teyit.':'Önceki 32 seçenek korundu. 2026 etiketi sezon doğrulamasıdır; koltuk veya bilet müsaitliği değildir.')+'</p><div class="controls"><input id="'+id+'Search" type="search" placeholder="'+(food?'Yemek, restoran veya bölge ara…':'Aktivite, müze veya bölge ara…')+'" aria-label="'+(food?'Yemek ara':'Katalogda ara')+'" value="'+esc(food?foodSearch:search)+'">'+(!food?'<select id="catalogVerified" aria-label="Tarih doğrulama">'+options({all:'Tüm doğrulama durumları',confirmed:'2026 doğrulandı',pending:'Teyit gereken / sürekli yer'},verification)+'</select>':'')+'<button data-favs aria-pressed="'+favOnly+'">♡ Favoriler</button></div><div class="chips">'+categories.map(c=>'<button data-cat="'+esc(c)+'" aria-pressed="'+(filter===c)+'">'+esc(c)+'</button>').join('')+'</div><p class="muted" id="'+id+'Count">'+found.length+' seçenek · '+count()+' durak planınızda</p><div class="catalog-grid">'+found.map(a=>{const p=image(a);return '<article class="photo-card" data-item="'+a.id+'">'+photo(a)+(p?'<span class="photo-credit">Resmî tanıtım görseli · '+link(p.page,'Kaynak')+'</span>':'')+'<div class="body"><span class="badge '+(a.status==='2026 doğrulandı'?'':'wait')+'">'+esc(a.status)+'</span><h3>'+esc(a.title)+'</h3>'+(food?'<strong>'+esc(a.dish)+'</strong><div class="date">'+esc(a.area)+'</div>':'<div class="date">'+esc(a.date)+'</div>')+'<p>'+esc(a.desc)+'</p></div><details><summary>Detay, fiyat & resmî bağlantılar</summary><p>'+esc(a.tip)+'</p><p><strong>'+esc(a.price)+'</strong></p><div class="links">'+link(a.url,food?'Menü / masa':'Resmî site / bilet')+link(maps(a.place),'Harita')+'</div></details><div class="add"><select aria-label="'+esc(a.title)+' için gün">'+options(Object.fromEntries(days.map(d=>[d,d+' Aralık'+(d==='20'?' · 🎂 Nergis':d==='21'?' · 🎂 Oben':'')])),currentDay)+'</select><button class="primary" data-add="'+a.id+'">+ Ekle</button><button data-favorite="'+a.id+'" aria-pressed="'+state.favorites.includes(a.id)+'" aria-label="'+esc(a.title)+' favori">'+(state.favorites.includes(a.id)?'♥':'♡')+'</button></div></article>'}).join('')+'</div>'+(found.length?'':'<p class="empty">Bu filtrelerde sonuç yok.</p>')+'<p class="source-note">Fiyat ve müsaitlik değişebilir. Fotoğraflar mekânların resmî tanıtım arşivlerinden; seçilen tarihin veya aynı menünün garantisi değil. Fotoğraf bulunmayan yerlerde simge kullanılır.</p>'}
function renderMap(){const list=draft.days[currentDay];const hotel=hotelFor();const stops=[...(hotel?[{uid:'hotel',title:hotel.name||'Otel',place:hotel.address}]:[]),...list.map(s=>({uid:s.uid,title:stopTitle(s),place:stopPlace(s)})).filter(s=>s.place)];if(!stops.some(s=>s.uid===activePhotoStop))activePhotoStop=stops[0]?.uid||'';const chosen=stops.find(s=>s.uid===activePhotoStop),q=chosen?.place||'London United Kingdom';$('map').innerHTML='<div class="eyebrow">Konum & ulaşım</div><h2>Günün Londra haritası.</h2>'+dayButtons()+'<p class="muted">Durak seçin; haritayı yakınlaştırabilir ve sürükleyebilirsiniz. Her iki durak arasında ayrıca rota açabilirsiniz.</p><div class="map-list">'+stops.map(s=>'<button data-map-stop="'+s.uid+'" aria-pressed="'+(s.uid===activePhotoStop)+'">📍 '+esc(s.title)+'</button>').join('')+'</div><iframe class="large-map" title="'+esc(chosen?.title||'Londra')+' haritası" src="https://maps.google.com/maps?q='+encodeURIComponent(q)+'&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe><p class="muted">'+esc(chosen?.title||'Henüz gününüze durak eklenmedi. Londra genel haritası gösteriliyor.')+'</p><div class="panel-actions">'+link(maps(q),'Tam haritayı aç')+link('https://tfl.gov.uk/plan-a-journey/','TfL ile ulaşım kontrolü')+'</div>'+list.map((s,i)=>renderLeg(s,list[i-1],currentDay)).join('')+'<p class="source-note">Harita internet gerektirir. Adres araması kullanılır; giriş kapısını biletinizden teyit edin. Yolculuk süresi ve ulaşım çalışmaları canlı rota ekranında kontrol edilir, burada hesaplanmış gibi gösterilmez.</p>'}
function tripField(label,name,value,type='text',extra=''){return field(label,'<input name="'+name+'" data-trip-field="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extra+'>')}
function renderTrip(){const family={all:'İki aile · 7 kişi',gani:'Gani ailesi · 3 kişi',serkan:'Serkan ailesi · 4 kişi'};$('trip').innerHTML='<div class="eyebrow">Gidiş, dönüş, evimiz</div><h2>Uçuş & otel bilgileri</h2><p class="muted">İki aile için ayrı veya ortak kayıt ekleyebilirsiniz. Bilgiler yalnızca bu cihazda tutulur; PNR, pasaport ve ödeme bilgisi girmeyin. Sonunda “Planı kaydet”e basın.</p><div class="planner-toolbar"><h3>✈️ Uçuşlar</h3><button class="secondary" data-new-flight>+ Uçuş ekle</button></div><div class="booking-grid">'+draft.flights.map(f=>'<article class="card" data-trip="flights" data-trip-uid="'+esc(f.uid)+'"><div class="trip-form">'+field('Aile','<select data-trip-field="family">'+options(family,f.family)+'</select>')+field('Yön','<select data-trip-field="direction">'+options({out:'Londra’ya gidiş',back:'Dönüş',other:'Diğer uçuş'},f.direction)+'</select>')+tripField('Havayolu / uçuş no','number',f.number)+tripField('Kalkış havalimanı','from',f.from)+tripField('Varış havalimanı','to',f.to)+tripField('Uçuş tarihi','date',f.date,'date')+tripField('Kalkış · yerel saat','depart',f.depart,'time')+tripField('Varış · yerel saat','arrive',f.arrive,'time')+tripField('Terminal / kısa not','terminal',f.terminal)+'</div><div class="panel-actions"><button data-delete-trip>Uçuş kaydını kaldır</button></div></article>').join('')+(!draft.flights.length?'<p class="empty">Henüz uçuş girilmedi. Gidiş ve dönüş için ayrı kayıt ekleyin.</p>':'')+'</div><div class="planner-toolbar"><h3>🏨 Oteller</h3><button class="secondary" data-new-hotel>+ Otel ekle</button></div><div class="booking-grid">'+draft.hotels.map(h=>'<article class="card" data-trip="hotels" data-trip-uid="'+esc(h.uid)+'"><div class="trip-form">'+field('Aile','<select data-trip-field="family">'+options(family,h.family)+'</select>')+tripField('Otel adı','name',h.name)+field('Durum','<select data-trip-field="status">'+options({todo:'Araştırılıyor',selected:'Seçildi · henüz onaysız',booked:'Rezervasyon onaylandı'},h.status)+'</select>')+'<div class="wide">'+tripField('Tam adres · rotaların başlangıcı','address',h.address)+'</div>'+tripField('Giriş tarihi','checkin',h.checkin,'date')+tripField('Çıkış tarihi','checkout',h.checkout,'date')+'</div><div class="panel-actions">'+(h.address?link(maps(h.address),'Oteli haritada aç'):'')+'<button data-delete-trip>Otel kaydını kaldır</button></div></article>').join('')+(!draft.hotels.length?'<p class="empty">Otel adresini girince günlük rotalar otelden başlayabilir.</p>':'')+'</div><div class="note-box" style="margin-top:20px">Kalkış ve varış saatleri ilgili havalimanının yerel saatidir. Gece yarısını geçen uçuş veya aktarma varsa kısa notla belirtin. Aynı gün varış/dönüş etkinliklerini uçuşa göre siz seçin; sistem otomatik saat uydurmaz.</div>'}
function allStops(){return days.flatMap(d=>draft.days[d].map(s=>({d,s})))}
function renderBookings(){const stops=allStops();$('bookings').innerHTML='<div class="eyebrow">Bilet, masa ve ulaşım</div><h2>Planın yapılacak işleri.</h2><p class="muted">Seçtiğiniz duraklardan oluşur. Burada durum değiştirmek bilet almaz veya rezervasyon yapmaz; gerçek onayı aldıktan sonra “Onay alındı” seçin.</p><div class="panel-actions"><button class="primary" data-export-brief>↓ Bana iletmek için plan özeti indir</button><button data-copy-brief>Özeti kopyala</button></div><div class="note-box">Planı kaydedip özeti bu sohbete eklediğinizde bilet, restoran ve ulaşım seçeneklerini birlikte netleştirebiliriz. Henüz otomatik bir rezervasyon hizmetine bağlı değil; bu sayfa üzerinden arka planda işlem başlatılmaz.</div><h3 style="margin-top:24px">Bilet & masa işleri</h3><div class="booking-grid">'+stops.map(({d,s})=>{const a=itemFor(s);return '<article class="booking-card" data-uid="'+s.uid+'"><span class="eyebrow">'+dayLabel(d)+' · '+esc(s.time||'Saat seçilmedi')+'</span><h3>'+esc(a.title)+'</h3><p>'+esc(a.kind==='food'?'Masa, çocuk menüsü, alerji ve doğum günü seçeneklerini sor.':'Seans, yaş koşulu, bilet ve 7 kişilik müsaitliği kontrol et.')+'</p>'+notice(s,d).map(w=>'<p class="warning">'+esc(w)+'</p>').join('')+'<div class="links">'+(a.url?link(a.url,a.kind==='food'?'Resmî menü / rezervasyon':'Resmî bilet sayfası'):'')+'</div><div class="stop-fields">'+field('İşin durumu',select('status',statuses,s.status))+field('Toplam GBP · varsa',input('cost',s.cost,'number','min="0" step="0.01"'))+field('Kısa not',input('note',s.note))+'</div></article>'}).join('')+(stops.length?'':'<p class="empty">Önce aktivite veya restoranları günlere ekleyin.</p>')+'</div><h3 style="margin-top:24px">Ulaşım işleri</h3><p class="muted">Otel → ilk durak ve her iki durak arasındaki rotaları Harita sekmesinden açın. Pay sürelerini günlük plana girin; uçuş / havalimanı transferlerini de özel durak olarak ekleyebilirsiniz.</p><button data-goto="map">Günlük ulaşım rotalarını aç</button>'}
function summary(){let lines=['FLYFAM · LONDRA · 19–24 ARALIK 2026','Gani, Mine, Oben / Serkan, Melis, Aziz, Nergis','20 Aralık: Nergis 4. yaş | 21 Aralık: Oben 5. yaş','Durum: '+(dirty()?'KAYDEDİLMEMİŞ TASLAK':'Kaydedilen plan'),'Son kayıt: '+(saved.savedAt||'yok'),''];for(const d of days){lines.push(dayLabel(d));for(const s of draft.days[d]){lines.push((s.time||'Saat seçilmedi')+' · '+stopTitle(s)+' · '+s.duration+' dk · '+(s.group==='all'?'7 kişi':s.group==='gani'?'3 kişi Gani ailesi':'4 kişi Serkan ailesi'));lines.push('Adres: '+stopPlace(s),'İş: '+statuses[s.status]+'; girilen toplam GBP: '+(s.cost||'belirsiz'),'Yol: '+modes[s.mode]+'; ayrılan pay: '+(s.travel||'teyit')+' dk');if(s.note)lines.push('Not: '+s.note);const a=itemFor(s);if(a.url)lines.push('Resmî site: '+a.url)}if(!draft.days[d].length)lines.push('Henüz seçim yok');lines.push('')}lines.push('UÇUŞLAR',...draft.flights.map(f=>[f.family,f.direction,f.number,f.from+' → '+f.to,f.date,f.depart+' / '+f.arrive,f.terminal].filter(Boolean).join(' · ')),'OTELLER',...draft.hotels.map(h=>[h.family,h.name,h.address,h.checkin+' → '+h.checkout,h.status].filter(Boolean).join(' · ')),'','Bu özet tek başına satın alma veya rezervasyon talimatı değildir.');return lines.join('\n')}
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function renderCurrent(){if(activeTab==='plan')renderPlan();if(activeTab==='map')renderMap();if(activeTab==='trip')renderTrip();if(activeTab==='bookings')renderBookings();if(activeTab==='catalog'||activeTab==='food')renderCatalog(activeTab==='food');updateSave()}
const tabdefs=[['plan','📅 Planım'],['catalog','🎡 Aktiviteler'],['food','🍽️ Yemekler'],['map','📍 Harita'],['trip','✈️ Uçuş & Otel'],['bookings','🎟️ Bilet & rezervasyon'],['vize','🛂 Vize'],['info','💡 Öneriler & notlar']];
function showTab(id,focus=true){if(!tabdefs.some(t=>t[0]===id))id='plan';activeTab=id;document.querySelectorAll('.tab-panel').forEach(p=>{const on=p.id===(id==='plan'?'planner':id);p.classList.toggle('active',on);p.hidden=!on});document.querySelectorAll('[data-tab]').forEach(b=>{b.setAttribute('aria-selected',b.dataset.tab===id);b.tabIndex=b.dataset.tab===id?0:-1});renderCurrent();history.replaceState(null,'','#'+id);if(focus){document.querySelector('[data-tab="'+id+'"]').scrollIntoView({block:'nearest',inline:'nearest'});window.scrollTo({top:document.querySelector('.nav').offsetTop,behavior:'smooth'})}}
const main=document.querySelector('main');
// Keep legacy visa state and controls intact; move supporting material into its own tab.
const info=document.createElement('section');info.id='info';info.className='tab-panel';for(const id of ['hazirlik','program','lojistik','kaynak']){const s=$(id);if(id==='hazirlik'){s.querySelector('h2').textContent='Aileler & kayıtlar';s.querySelector('.banner').hidden=true}info.append(s)}main.append(info);$('vize').classList.add('tab-panel');$('kesfet').classList.add('hidden-legacy');for(const id of ['planner','catalog','food','map','trip','bookings']){const s=document.createElement('section');s.id=id;s.className='tab-panel';s.setAttribute('role','tabpanel');s.setAttribute('aria-labelledby','tab-'+(id==='planner'?'plan':id));main.prepend(s)}$('vize').setAttribute('role','tabpanel');$('vize').setAttribute('aria-labelledby','tab-vize');info.setAttribute('role','tabpanel');info.setAttribute('aria-labelledby','tab-info');
document.querySelector('.nav').innerHTML='<div class="wrap" role="tablist" aria-label="Seyahat bölümleri">'+tabdefs.map(([id,title])=>'<button role="tab" id="tab-'+id+'" data-tab="'+id+'" aria-controls="'+(id==='plan'?'planner':id)+'" aria-selected="false">'+title+'</button>').join('')+'</div>';
const savebar=document.createElement('div');savebar.id='savebar';savebar.className='savebar noprint';savebar.innerHTML='<div><strong><span class="status-dot"></span><span id="saveHeading"></span></strong><small id="saveDetail"></small></div><button id="savePlan" class="primary">Planı kaydet</button>';main.append(savebar);const toastEl=document.createElement('div');toastEl.id='toast';toastEl.role='status';toastEl.hidden=true;document.body.append(toastEl);
const cover=photos.winter||photos.somerset;if(cover){const img=document.createElement('img');img.className='planner-hero-photo';img.src=cover.path;img.alt='';document.querySelector('header').prepend(img)}document.querySelector('.intro').innerHTML='İki aile, iki doğum günü, bir Londra.<br>Aktiviteleri ve lezzetleri seçin; gün gün kendi seyahatinizi oluşturun.';
$('savePlan').onclick=persist;
main.addEventListener('click',e=>{const t=e.target.closest('button');if(!t)return;if(t.hasAttribute('data-backup')){$('export').click();return}if(t.hasAttribute('data-import-plan')){$('import').click();return}if(t.hasAttribute('data-print-plan')){if(dirty()){toast('Önce planı kaydedin; yazdırma kaydedilen plan içindir.');return}window.print();return}if(t.dataset.goto){showTab(t.dataset.goto);return}if(t.dataset.day){currentDay=t.dataset.day;renderCurrent();return}if(t.dataset.add){addItem(t.dataset.add,t.parentElement.querySelector('select').value);return}if(t.hasAttribute('data-favs')){favOnly=!favOnly;renderCatalog(activeTab==='food');return}if(t.dataset.cat){if(activeTab==='food')foodCategory=t.dataset.cat;else category=t.dataset.cat;renderCatalog(activeTab==='food');return}if(t.dataset.favorite){const id=t.dataset.favorite;state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id];save();renderCatalog(activeTab==='food');return}if(t.dataset.mapStop){activePhotoStop=t.dataset.mapStop;renderMap();return}if(t.dataset.action){const uid=t.closest('[data-uid]').dataset.uid;for(const d of days){const i=draft.days[d].findIndex(s=>s.uid===uid);if(i<0)continue;const list=draft.days[d];if(t.dataset.action==='remove')list.splice(i,1);if(t.dataset.action==='up'&&i>0)[list[i-1],list[i]]=[list[i],list[i-1]];if(t.dataset.action==='down'&&i<list.length-1)[list[i+1],list[i]]=[list[i],list[i+1]]}renderCurrent();return}if(t.hasAttribute('data-new-flight')){draft.flights.push({uid:crypto.randomUUID(),family:'all',direction:draft.flights.length?'back':'out',number:'',from:'',to:'',date:draft.flights.length?'2026-12-24':'2026-12-19',depart:'',arrive:'',terminal:''});renderTrip();updateSave();return}if(t.hasAttribute('data-new-hotel')){draft.hotels.push({uid:crypto.randomUUID(),family:'all',name:'',address:'',checkin:'2026-12-19',checkout:'2026-12-24',status:'todo'});renderTrip();updateSave();return}if(t.hasAttribute('data-delete-trip')){const card=t.closest('[data-trip]');draft[card.dataset.trip]=draft[card.dataset.trip].filter(x=>x.uid!==card.dataset.tripUid);renderTrip();updateSave();return}if(t.hasAttribute('data-export-brief')){download(summary(),'londra-koordinasyon-ozeti.txt','text/plain;charset=utf-8');return}if(t.hasAttribute('data-copy-brief')){navigator.clipboard.writeText(summary()).then(()=>toast('Özet kopyalandı; bu sohbete yapıştırabilirsiniz.')).catch(()=>toast('Kopyalama kullanılamadı; özeti indirin.'))}});
main.addEventListener('input',e=>{const t=e.target;if(t.id==='catalogSearch'||t.id==='foodSearch'){const pos=t.selectionStart;if(t.id==='foodSearch')foodSearch=t.value;else search=t.value;renderCatalog(activeTab==='food');const el=$(t.id);el.focus();el.setSelectionRange(pos,pos);return}if(t.dataset.tripField){const card=t.closest('[data-trip]'),item=draft[card.dataset.trip].find(x=>x.uid===card.dataset.tripUid);item[t.dataset.tripField]=t.value;updateSave();return}if(t.dataset.field){const card=t.closest('[data-uid]');if(!card)return;const found=allStops().find(x=>x.s.uid===card.dataset.uid);if(!found)return;const f=t.dataset.field;if(f==='day')return;found.s[f]=['duration','travel'].includes(f)?Math.max(0,Math.min(1440,Number(t.value)||0)):t.value;updateSave()}});
main.addEventListener('change',e=>{const t=e.target;if(t.id==='catalogVerified'){verification=t.value;renderCatalog(false);return}if(t.dataset.field){const found=allStops().find(x=>x.s.uid===t.closest('[data-uid]')?.dataset.uid);if(!found)return;if(t.dataset.field==='day'){const from=draft.days[found.d],index=from.findIndex(s=>s.uid===found.s.uid);draft.days[t.value].push(from.splice(index,1)[0]);currentDay=t.value}renderCurrent()}else if(t.dataset.tripField&&t.dataset.tripField==='address'){renderTrip()}});
main.addEventListener('submit',e=>{if(e.target.id!=='customForm')return;e.preventDefault();const f=new FormData(e.target),title=String(f.get('title')).trim();if(!title)return;const s=newStop({id:'custom',title,place:String(f.get('place')||''),duration:Number(f.get('duration'))||60},String(f.get('time')||''));s.status='free';draft.days[currentDay].push(s);renderPlan();updateSave()});
document.querySelector('.nav').addEventListener('click',e=>{const t=e.target.closest('[data-tab]');if(t)showTab(t.dataset.tab)});document.querySelector('.nav').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const i=tabdefs.findIndex(x=>x[0]===activeTab),n=e.key==='Home'?0:e.key==='End'?tabdefs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabdefs.length)%tabdefs.length;showTab(tabdefs[n][0],false);$('tab-'+tabdefs[n][0]).focus()});
document.addEventListener('click',e=>{const a=e.target.closest('a[href^="#"]');if(!a)return;const h=a.getAttribute('href').slice(1);if(['program','hazirlik','lojistik','kaynak'].includes(h)){showTab('info',false)}if(h==='vize')showTab('vize',false);if(h==='kesfet'){e.preventDefault();showTab('catalog')}});
window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue=''}});
// Extend backups to carry the saved itinerary as well as the existing visa progress.
$('export').textContent='↓ Kaydedilen tüm verileri yedekle';$('export').onclick=()=>{if(dirty())toast('Yedek kaydedilen planı içerir; önce Planı kaydet ile taslağı saklayın.');download(JSON.stringify({version:2,state,plan:saved},null,2),'londra-2026-tam-yedek.json','application/json')};
$('import').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>2000000)throw Error();const data=JSON.parse(await f.text());if(![1,2].includes(data.version)||!data.state||typeof data.state!=='object')throw Error();const old=data.state;if(typeof old.notes!=='string'||!Array.isArray(old.favorites)||!['checks','na','appointments','stages'].every(k=>old[k]&&typeof old[k]==='object'&&!Array.isArray(old[k])))throw Error();const incoming=data.version===2?cleanPlan(data.plan):null;if(!confirm('Yedek bu cihazdaki '+(incoming?'plan ve ':'')+'vize işaretlemelerinin yerine geçecek. Yüklensin mi?'))return;state={checks:{},na:{},appointments:{},stages:{},favorites:old.favorites.filter(x=>byId(x)),notes:old.notes.slice(0,20000)};for(const p of people){for(const [task]of [...common,...(p[4]?children:adults)]){const k=p[0]+':'+task;state.checks[k]=old.checks[k]===true;state.na[k]=old.na[k]===true}if(typeof old.appointments[p[0]]==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(old.appointments[p[0]]))state.appointments[p[0]]=old.appointments[p[0]];if([...$('stage').options].some(o=>o.value===old.stages[p[0]]))state.stages[p[0]]=old.stages[p[0]]}save();if(incoming){draft=incoming;persist()}renderPerson();$('notes').value=state.notes;renderCurrent();toast('Yedek yüklendi.')}catch(err){toast('Yedek okunamadı; geçerli Londra yedeğini seçin.')}finally{e.target.value=''}};
const printButton=document.createElement('button');printButton.textContent='🖨 Kaydedilen günlük planı yazdır';printButton.onclick=()=>{if(dirty()){toast('Önce planı kaydedin; yazdırma kaydedilen plan içindir.');return}showTab('plan',false);window.print()};$('info').querySelector('.controls').prepend(printButton);
$('print').textContent='🖨 Bu sekmeyi yazdır';$('print').onclick=()=>window.print();
window.addEventListener('beforeprint',()=>{const p=$(activeTab==='plan'?'planner':activeTab);p?.classList.add('printing')});window.addEventListener('afterprint',()=>document.querySelectorAll('.printing').forEach(p=>p.classList.remove('printing')));
showTab(tabdefs.some(t=>t[0]===location.hash.slice(1))?location.hash.slice(1):'plan',false);
})();
