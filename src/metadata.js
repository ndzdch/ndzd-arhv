export const filmCatalog = [
  ['Kodak Vision', /(?:kodak[\s_-]*)?vision(?:[\s_-]*3)?(?=$|[\s_-]|\d)/i],
  ['Agfa Aviphot', /(?:agfa[\s_-]*)?aviphot(?=$|[\s_-]|\d)/i],
  ['Ilford Pan', /(?:ilford[\s_-]*)?pan(?=$|[\s_-]|\d)/i],
  ['Ilford XP2', /(?:ilford[\s_-]*)?xp2(?:[\s_-]*super)?(?=$|[\s_-]|\d)/i],
  ['Kodak Gold', /(?:kodak[\s_-]*)?gold(?=$|[\s_-]|\d)/i],
  ['Kodak ColorPlus', /(?:kodak[\s_-]*)?colou?r[\s_-]*plus(?=$|[\s_-]|\d)/i],
  ['Kodak Ultramax', /(?:kodak[\s_-]*)?ultra[\s_-]*max(?=$|[\s_-]|\d)/i],
  ['Kodak Portra', /(?:kodak[\s_-]*)?portra(?=$|[\s_-]|\d)/i],
  ['Kodak Ektar', /(?:kodak[\s_-]*)?ektar(?=$|[\s_-]|\d)/i],
  ['Kodak Ektachrome', /(?:kodak[\s_-]*)?ektachrome(?=$|[\s_-]|\d)/i],
  ['Kodak Tri-X', /(?:kodak[\s_-]*)?tri[\s_-]*x\b/i],
  ['Ilford HP5 Plus', /(?:ilford[\s_-]*)?hp5(?:[\s_-]*plus)?\b/i],
  ['Ilford FP4 Plus', /(?:ilford[\s_-]*)?fp4(?:[\s_-]*plus)?\b/i],
  ['Ilford Delta', /(?:ilford[\s_-]*)?delta\b/i],
  ['Fujifilm Superia X-TRA', /(?:fuji(?:film)?[\s_-]*)?superia(?:[\s_-]*x[\s_-]*tra)?\b/i],
  ['Fujifilm Velvia', /(?:fuji(?:film)?[\s_-]*)?velvia\b/i],
  ['Fujifilm Provia', /(?:fuji(?:film)?[\s_-]*)?provia\b/i],
  ['Fujifilm', /fuji(?:film)?\b/i],
  ['CineStill T', /cine[\s_-]*still[\s_-]*800t\b/i],
  ['CineStill D', /cine[\s_-]*still[\s_-]*(?:400|50)d\b/i],
  ['Fomapan', /foma(?:pan)?\b/i],
];
export const isoValues=['25','50','64','80','100','125','160','200','250','320','400','500','640','800','1000','1600','3200'];
export function inferFolderMetadata(name) {
  const title=String(name).trim();
  const normalized=title.replaceAll('_',' ');
  const match=filmCatalog.map(([film,re])=>({film,match:re.exec(normalized)})).find(x=>x.match);
  let iso='',rest=normalized;
  if(match){
    const end=match.match.index+match.match[0].length;
    const adjacent=/^[\s_-]*(?:iso[\s_-]*)?(\d{2,4})(?:[tdf])?(?=$|[\s_.()\-])/i.exec(normalized.slice(end));
    if(adjacent&&isoValues.includes(adjacent[1]))iso=adjacent[1];
    const embedded=match.match[0].match(/(800|400|50)[td]$/i);
    if(embedded)iso=embedded[1];
    rest=normalized.slice(0,match.match.index)+' '+normalized.slice(end+(adjacent?.[0].length||0));
  }
  const explicitIso=normalized.match(/\biso[\s_:-]*(\d{2,4})\b/i);
  if(explicitIso)iso=explicitIso[1];
  rest=rest.replace(/\biso[\s_:-]*\d{2,4}\b/gi,' ');
  rest=rest.replace(/\b(?:19|20)\d{2}[-. ]\d{1,2}(?:[-. ]\d{1,2})?\b/g,' ');
  const explicitNumber=rest.match(/(?:№|#|\broll\b|\bfilm\b|папка|рулон|плёнка|пленка)[\s_:#-]*(\d{1,6})(?=$|[^\d])/i);
  const leading=rest.match(/^\s*(\d{1,3})(?=$|[\s_.()\-])/);
  const trailing=rest.match(/[\s_#-](\d{1,3})\s*$/);
  return {title,film:match?.film||'',iso,number:explicitNumber?.[1]||leading?.[1]||trailing?.[1]||''};
}
export function periodLabel(r) {
  const month=value=>/^\d{4}-\d{2}$/.test(value||'')?new Intl.DateTimeFormat('ru',{month:'long',year:'numeric'}).format(new Date(value+'-01')).replace(' г.',''):value;
  if(r.dateStart)return month(r.dateStart)+(r.dateEnd&&r.dateEnd!==r.dateStart?' — '+month(r.dateEnd):'');
  return (r.dateEnd?'До '+month(r.dateEnd):month(r.date))||'Дата не указана';
}
export function validPeriod(start,end) {return !start || !end || (String(end).length===4?end+'-12':end)>=(String(start).length===4?start+'-01':start);}

// Use only information actually present in the folder name.
export function uploadFolderMetadata(name) {
  const inferred=inferFolderMetadata(name),normalized=String(name||'').replaceAll('_',' ');
  let title=normalized;
  const film=filmCatalog.find(([,pattern])=>pattern.test(title));
  if(film)title=title.replace(film[1],' ');
  if(inferred.iso)title=title.replace(new RegExp('(?:iso[\\s:-]*)?'+inferred.iso+'(?:[tdf])?\\b','i'),' ');
  title=title.replace(/\b(?:19|20)\d{2}(?:[-. ]\d{1,2})?(?:[-. ]\d{1,2})?\b/g,' ');
  if(inferred.number)title=title.replace(new RegExp('(?:№|#|roll|film|папка|рулон|плёнка|пленка)?[\\s:#-]*'+inferred.number+'(?=$|[\\s.()—-])','i'),' ');
  title=title.replace(/^[\s.()—-]+|[\s.()—-]+$/g,'').replace(/\s+/g,' ');
  const year=normalized.match(/\b((?:19|20)\d{2})(?:[-. ](0?[1-9]|1[0-2]))?\b/);
  return {...inferred,title: /^(новая плёнка|photos?|images?|dcim|фото)$/i.test(title)?'':title,dateStart:year&&year[2]?`${year[1]}-${year[2].padStart(2,'0')}`:'',filenameYear:year?.[1]||''};
}
const transliteration={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
export function filenameStem(data={}) {
 const slug=value=>String(value||'').toLowerCase().split('').map(c=>transliteration[c]??c).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
 return ['ndzd',slug(data.title)].filter(Boolean).join('-');
}
export function numberedFilename(stem,index,part='') {
 const safe=String(stem||'photo').replace(/\.jpe?g$/i,'').replace(/[-_]\d{3}$/,'').replace(/[\\/:\x00-\x1f]/g,'-').replace(/^\.+/,'').trim().slice(0,140)||'photo';
 return safe+'-'+String(index).padStart(3,'0')+(['l','r'].includes(part)?'-'+part:'')+'.jpg';
}

export function formatRollNumber(value){const digits=String(value??'').replace(/\D/g,'');return digits?digits.replace(/^0+(?=\d)/,'').padStart(3,'0'):'';}

export function folderName(data={}){const title=String(data.title||'').trim();return [formatRollNumber(data.number),[data.film,data.iso].filter(Boolean).join(' '),title?title[0].toLocaleUpperCase('ru')+title.slice(1):''].filter(Boolean).join(' — ');}
