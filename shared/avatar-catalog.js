// Original pixel parts, all sharing a 48 × 64 grid and the same neck/feet anchors.
// Hair tags are observable appearance only; no gender or identity classification.
const hair = (id, name, length, fringe, texture, kind) => ({ id, name, length, fringe, texture, kind });
export const HAIRS = [
  hair(0,'옆으로 넘긴 짧은 머리',0,.25,0,'sweep'), hair(1,'둥근 단발',.55,.7,0,'bob'),
  hair(2,'긴 생머리',1,.25,0,'long'), hair(3,'일자 앞머리',.12,1,0,'bowl'),
  hair(4,'가르마 머리',.15,.2,0,'part'), hair(5,'짧은 곱슬',.18,.55,1,'curl'),
  hair(6,'아주 짧은 머리',0,0,0,'crop'), hair(7,'올린 머리',.1,0,.2,'quiff'),
  hair(8,'부드러운 투블록',.12,.6,0,'undercut'), hair(9,'뾰족한 짧은 머리',.08,.15,.8,'spike'),
  hair(10,'귀밑 단발',.38,.85,0,'shortbob'), hair(11,'가르마 단발',.6,.15,0,'partbob'),
  hair(12,'웨이브 단발',.65,.4,.8,'wavebob'), hair(13,'어깨 길이 머리',.8,.4,0,'shoulder'),
  hair(14,'긴 앞머리 생머리',1,.95,0,'longbang'), hair(15,'긴 웨이브',1,.35,.9,'wave'),
  hair(16,'높은 포니테일',.75,.6,0,'pony'), hair(17,'낮은 포니테일',.7,.2,0,'lowpony'),
  hair(18,'양갈래 머리',.8,.8,0,'twintail'), hair(19,'올림머리',.2,.1,0,'bun'),
  hair(20,'양쪽 묶은 머리',.25,.85,0,'doublebun'), hair(21,'땋은 머리',1,.3,.4,'braid'),
  hair(22,'풍성한 곱슬',.6,.6,1,'fluffy'), hair(23,'머리카락 없음',0,0,0,'bald'),
];
const options = names => names.map((name,id)=>({id,name}));
export const FACES=options(['둥근 얼굴','계란형 얼굴','통통한 얼굴','갸름한 얼굴','각진 얼굴','작은 얼굴']);
export const EYES=options(['또렷한 눈','동그란 눈','차분한 눈','웃는 눈','가느다란 눈','반짝이는 눈']);
export const MOUTHS=options(['작은 미소','활짝 웃음','차분한 입','밝은 미소']);
export const TOPS=options(['기본 티셔츠','줄무늬 티셔츠','배색 티셔츠','폴로 셔츠','후드티','맨투맨','주머니 셔츠','체크 셔츠','니트 조끼','카디건','데님 재킷','블레이저','넥타이 셔츠','리본 블라우스','멜빵바지 상의','긴 소매 니트']);
export const BOTTOMS=options(['일자 바지','청바지','반바지','주름 치마','긴 치마','넓은 바지','트레이닝 바지','멜빵바지 하의']);
export const SHOES=options(['운동화','단화','로퍼','하이탑','부츠','샌들']);
export const GLASSES=options(['안경 없음','둥근 안경','네모 안경','가는 테 안경','둥근 큰 안경','선글라스']);
export const HATS=options(['머리 장식 없음','볼캡','베레모','비니','버킷햇','리본','머리핀','꽃핀','헤드폰','새싹 머리띠']);
export const BAGS=options(['가방 없음','배낭','크로스백','에코백','작은 책가방','목도리']);
export const SKIN_COLORS=['#f6d6bd','#efbc99','#dfa77c','#c58a60','#a76a49','#825038','#603d30','#f3c6af'];
export const HAIR_COLORS=['#292630','#44302c','#644335','#916344','#bc945f','#dec58e','#eee0c5','#89848b','#744954','#986b85','#52716e','#51617b'];
export const CLOTH_COLORS=['#bd6b65','#d99b83','#e2bc67','#efdbac','#6f9374','#46776f','#6094a5','#778bbb','#9b7baa','#cc95a7','#f0e8d7','#393f50','#785c49','#66717d','#a9bb8d','#a57355'];
export const PANTS_COLORS=['#465571','#6a839b','#343d4a','#736353','#a99b7c','#d5c5a9','#705d79','#54716a'];
export const CATALOG={hair:HAIRS,faceShape:FACES,eyeStyle:EYES,mouthStyle:MOUTHS,top:TOPS,bottom:BOTTOMS,shoes:SHOES,eyewear:GLASSES,hat:HATS,bag:BAGS};
export const DIRECTIONS=['down','left','right','up'];
export const LAYERS=['hairBack','legs','shoes','body','bagBack','face','features','hairFront','eyewear','hat','bagFront'];
export const PIXEL_SPEC={width:48,height:64,frames:4,directions:DIRECTIONS,feet:[24,60],neck:[24,34],version:2};
export function randomAvatar(base,random=Math.random){
  const pick=list=>list[Math.floor(random()*list.length)];
  return {...base,style:pick(HAIRS).id,faceShape:pick(FACES).id,eyeStyle:pick(EYES.slice(0,3)).id,mouthStyle:pick(MOUTHS).id,top:pick(TOPS).id,bottom:pick(BOTTOMS).id,shoes:pick(SHOES).id,eyewear:random()<.32?pick(GLASSES.slice(1,5)).id:0,glasses:false,hat:random()<.26?pick(HATS).id:0,bag:random()<.25?pick(BAGS).id:0,skin:pick(SKIN_COLORS),hair:pick(HAIR_COLORS),shirt:pick(CLOTH_COLORS),pants:pick(PANTS_COLORS),shoeColor:pick(['#f0e8d7','#483f3f','#76554a']),accent:pick(CLOTH_COLORS)};
}
