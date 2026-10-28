const images = ['coast','lake','forest','mountain','alpine'].map(n=>`./prototype-assets/${n}.jpg`);
export const welcomeImage = images[1];
export function demoRolls() {
  const titles=['Тбилиси, тёплый май','Дорога к озеру','Лес после дождя','Выше облаков','Тихое утро','Ещё одно путешествие'];
  const films=['Kodak Gold 200','Kodak Portra 400','Ilford HP5 Plus'];
  return titles.map((title,i)=>({id:`demo/${42-i}`,sourceId:'demo',folder:`${42-i}_${title}`,number:String(42-i).padStart(3,'0'),title,
    film:films[i%3],date:i===5?'2025-12':`2026-${String(5-i).padStart(2,'0')}`,description:i===0?'Долгие прогулки, старые дома и свет перед закатом.':'',
    frames:Array.from({length:36},(_,j)=>({id:`demo/${42-i}/${j}`,name:`scan_${String(j+1).padStart(3,'0')}.jpg`,
      demoUrl:images[(i+j)%5],viewed:i%3===1 || (i%3===0 && j%3!==2),rating:i%3===0&&j%3===0?3:0,rejected:false}))}));
}
