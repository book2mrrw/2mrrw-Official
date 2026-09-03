// Country name <-> ISO 3166-1 alpha-2 <-> ISO 3166-1 numeric (world-atlas
// topojson feature ids). Shared between the Global Analytics page (country
// choropleth rendering) and its API route (unifying profiles.country, which
// is a free-text display name, with media_stream_events.country, which is
// already an ISO alpha-2 code from Vercel's geo headers) into one identity.
const NAME_TO_A2 = {
  "United States":"US","United Kingdom":"GB","Canada":"CA","Australia":"AU",
  "Germany":"DE","France":"FR","Japan":"JP","South Korea":"KR","Brazil":"BR",
  "Mexico":"MX","India":"IN","China":"CN","Spain":"ES","Italy":"IT","Netherlands":"NL",
  "Sweden":"SE","Norway":"NO","Denmark":"DK","Finland":"FI","Switzerland":"CH",
  "Austria":"AT","Belgium":"BE","Portugal":"PT","Ireland":"IE","New Zealand":"NZ",
  "Singapore":"SG","Hong Kong":"HK","Taiwan":"TW","Israel":"IL","United Arab Emirates":"AE",
  "Saudi Arabia":"SA","Nigeria":"NG","South Africa":"ZA","Ghana":"GH","Kenya":"KE",
  "Egypt":"EG","Ethiopia":"ET","Tanzania":"TZ","Uganda":"UG","Senegal":"SN",
  "Côte d'Ivoire":"CI","Cameroon":"CM","Zimbabwe":"ZW","Rwanda":"RW","Angola":"AO",
  "Mozambique":"MZ","Zambia":"ZM","Algeria":"DZ","Morocco":"MA","Tunisia":"TN",
  "Libya":"LY","Sudan":"SD","Somalia":"SO","Madagascar":"MG","Malawi":"MW",
  "Botswana":"BW","Namibia":"NA","Lesotho":"LS","Eswatini":"SZ","Burundi":"BI",
  "Sierra Leone":"SL","Liberia":"LR","Guinea":"GN","Guinea-Bissau":"GW","Mali":"ML",
  "Burkina Faso":"BF","Niger":"NE","Chad":"TD","Central African Republic":"CF",
  "Congo":"CG","Democratic Republic of the Congo":"CD","Gabon":"GA","Equatorial Guinea":"GQ",
  "São Tomé and Príncipe":"ST","Cape Verde":"CV","Comoros":"KM","Djibouti":"DJ",
  "Eritrea":"ER","Gambia":"GM","Togo":"TG","Benin":"BJ","Mauritania":"MR",
  "Cabo Verde":"CV","Mauritius":"MU","Seychelles":"SC","South Sudan":"SS",
  "Argentina":"AR","Chile":"CL","Colombia":"CO","Peru":"PE","Venezuela":"VE",
  "Ecuador":"EC","Bolivia":"BO","Paraguay":"PY","Uruguay":"UY","Guyana":"GY",
  "Suriname":"SR","Trinidad and Tobago":"TT","Jamaica":"JM","Cuba":"CU",
  "Dominican Republic":"DO","Haiti":"HT","Bahamas":"BS","Barbados":"BB",
  "Saint Lucia":"LC","Grenada":"GD","Saint Vincent and the Grenadines":"VC",
  "Antigua and Barbuda":"AG","Saint Kitts and Nevis":"KN","Panama":"PA",
  "Costa Rica":"CR","Guatemala":"GT","Honduras":"HN","El Salvador":"SV",
  "Nicaragua":"NI","Belize":"BZ","Dominica":"DM",
  "Russia":"RU","Ukraine":"UA","Poland":"PL","Romania":"RO","Czech Republic":"CZ",
  "Hungary":"HU","Bulgaria":"BG","Serbia":"RS","Slovakia":"SK","Croatia":"HR",
  "Greece":"GR","Turkey":"TR","Belarus":"BY","Lithuania":"LT","Latvia":"LV",
  "Estonia":"EE","Slovenia":"SI","North Macedonia":"MK","Bosnia and Herzegovina":"BA",
  "Montenegro":"ME","Albania":"AL","Kosovo":"XK","Moldova":"MD","Luxembourg":"LU",
  "Iceland":"IS","Liechtenstein":"LI","Andorra":"AD","Malta":"MT","Monaco":"MC",
  "San Marino":"SM","Cyprus":"CY","Armenia":"AM","Azerbaijan":"AZ","Georgia":"GE",
  "Kazakhstan":"KZ","Uzbekistan":"UZ","Turkmenistan":"TM","Kyrgyzstan":"KG",
  "Tajikistan":"TJ","Mongolia":"MN","Afghanistan":"AF","Pakistan":"PK",
  "Bangladesh":"BD","Sri Lanka":"LK","Nepal":"NP","Bhutan":"BT","Maldives":"MV",
  "Myanmar":"MM","Thailand":"TH","Vietnam":"VN","Cambodia":"KH","Laos":"LA",
  "Malaysia":"MY","Indonesia":"ID","Philippines":"PH","Brunei":"BN","Timor-Leste":"TL",
  "Papua New Guinea":"PG","Fiji":"FJ","Solomon Islands":"SB","Vanuatu":"VU",
  "Samoa":"WS","Tonga":"TO","Kiribati":"KI","Micronesia":"FM","Palau":"PW",
  "Marshall Islands":"MH","Nauru":"NR","Tuvalu":"TV",
  "Iran":"IR","Iraq":"IQ","Syria":"SY","Lebanon":"LB","Jordan":"JO","Kuwait":"KW",
  "Qatar":"QA","Bahrain":"BH","Oman":"OM","Yemen":"YE","Palestine":"PS",
  "Tajikistan":"TJ","North Korea":"KP",
};

// ─── ISO alpha-2 → ISO 3166-1 numeric (matches world-atlas feature IDs) ──────
const A2_TO_NUMERIC = {
  US:840,GB:826,CA:124,AU:36,DE:276,FR:250,JP:392,KR:410,BR:76,MX:484,
  IN:356,CN:156,ES:724,IT:380,NL:528,SE:752,NO:578,DK:208,FI:246,CH:756,
  AT:40,BE:56,PT:620,IE:372,NZ:554,SG:702,HK:344,TW:158,IL:376,AE:784,
  SA:682,NG:566,ZA:710,GH:288,KE:404,EG:818,ET:231,TZ:834,UG:800,SN:686,
  CI:384,CM:120,ZW:716,RW:646,AO:24,MZ:508,ZM:894,DZ:12,MA:504,TN:788,
  LY:434,SD:729,SO:706,MG:450,MW:454,BW:72,NA:516,LS:426,SZ:748,BI:108,
  SL:694,LR:430,GN:324,GW:624,ML:466,BF:854,NE:562,TD:148,CF:140,CG:178,
  CD:180,GA:266,GQ:226,ST:678,CV:132,KM:174,DJ:262,ER:232,GM:270,TG:768,
  BJ:204,MR:478,MU:480,SC:690,SS:728,AR:32,CL:152,CO:170,PE:604,VE:862,
  EC:218,BO:68,PY:600,UY:858,GY:328,SR:740,TT:780,JM:388,CU:192,DO:214,
  HT:332,BS:44,BB:52,LC:662,GD:308,VC:670,AG:28,KN:659,PA:591,CR:188,
  GT:320,HN:340,SV:222,NI:558,BZ:84,DM:212,RU:643,UA:804,PL:616,RO:642,
  CZ:203,HU:348,BG:100,RS:688,SK:703,HR:191,GR:300,TR:792,BY:112,LT:440,
  LV:428,EE:233,SI:705,MK:807,BA:70,ME:499,AL:8,MD:498,LU:442,IS:352,
  LI:438,AD:20,MT:470,MC:492,SM:674,CY:196,AM:51,AZ:31,GE:268,KZ:398,
  UZ:860,TM:795,KG:417,TJ:762,MN:496,AF:4,PK:586,BD:50,LK:144,NP:524,
  BT:64,MV:462,MM:104,TH:764,VN:704,KH:116,LA:418,MY:458,ID:360,PH:608,
  BN:96,TL:626,PG:598,FJ:242,SB:90,VU:548,WS:882,TO:776,KI:296,FM:583,
  PW:585,MH:584,NR:520,TV:798,IR:364,IQ:368,SY:760,LB:422,JO:400,KW:414,
  QA:634,BH:48,OM:512,YE:887,PS:275,KP:408,
};

const A2_TO_NAME = Object.fromEntries(Object.entries(NAME_TO_A2).map(([k, v]) => [v, k]));

export { NAME_TO_A2, A2_TO_NUMERIC, A2_TO_NAME };
