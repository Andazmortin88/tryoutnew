// Public display metadata. Payment amounts and entitlement durations are validated in Supabase SQL.
export const FREE_TRIAL_COUNT = 10;
export const PREMIUM_PLANS = Object.freeze([
  {code:'sprint_3',days:3,price:20000,label:'3 Hari',name:'Sprint',subtitle:'Belajar kilat'},
  {code:'intensif_7',days:7,price:29900,label:'7 Hari',name:'Intensif',subtitle:'Persiapan satu minggu'},
  {code:'launch_30',days:30,price:40000,label:'30 Hari',name:'Reguler',subtitle:'Belajar terstruktur'},
  {code:'promo_90',days:90,price:79900,label:'90 Hari',name:'Promo 3 Bulan',subtitle:'Hemat Rp40.100 dibanding tiga paket 30 hari'},
]);
