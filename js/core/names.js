// Fictional default data. Every name here can be edited in-game or replaced by an imported name pack.
export const NAME_GROUPS = {
  de: {
    first: ['Lukas','Jonas','Felix','Tobias','Niklas','Florian','Malte','Jannik','Moritz','Sven','Timo','Dominik','Kai','Bastian','Henrik','Ole','Fabian','Marvin','Julian','Leon','Torben','Mats','Benedikt','Jakob'],
    last: ['Brandtner','Kessler','Wolters','Hagedorn','Lindqvist','Feldmann','Achterberg','Rademacher','Stolle','Brückner','Overbeck','Hollmann','Kranich','Sauerland','Wiegand','Lohmeyer','Dittrich','Ellerbrock','Grabowski','Heitkamp','Junghans','Kortmann','Mertens','Niebuhr','Pfeiffer','Quandtner','Reinholt','Schaller','Tegtmeier','Vogtland','Wendling','Zierott'],
  },
  en: {
    first: ['Callum','Harvey','Owen','Rhys','Declan','Kieran','Elliot','Archie','Jamie','Lewis','Connor','Reece','Toby','Ashley','Ryan','Nathan'],
    last: ['Ashcombe','Blackwood','Carver','Denholm','Ellery','Fairbank','Gilmore','Hartigan','Ingram','Kettering','Lockwood','Marchant','Northcott','Oakley','Penrose','Radcliffe','Selwyn','Thorne','Wexford','Yardley'],
  },
  es: {
    first: ['Mateo','Iker','Álvaro','Hugo','Rodrigo','Sergio','Adrián','Pablo','Diego','Gonzalo','Marcos','Rubén','Javi','Unai'],
    last: ['Albarrán','Cuesta','Echeverri','Garrido','Ibarra','Lozano','Montalvo','Navarrete','Olmedo','Paredes','Quintero','Salcedo','Toledano','Valverde','Zamora','Escudero'],
  },
  it: {
    first: ['Lorenzo','Matteo','Riccardo','Davide','Simone','Tommaso','Federico','Gabriele','Nicolò','Alessio','Edoardo','Pietro'],
    last: ['Bellandi','Carrozza','Del Vecchio','Ferraresi','Galletti','Lombardo','Marchetti','Orsolini','Pagliuca','Rinaldi','Sartori','Tavecchio','Valsecchi','Zanetto'],
  },
  fr: {
    first: ['Théo','Maxime','Antoine','Hugo','Quentin','Bastien','Yanis','Noah','Romain','Clément','Kylian','Rayan','Mathis'],
    last: ['Aubertin','Beaulieu','Chevalier','Delacroix','Fournel','Garnier','Lachance','Marceau','Perrault','Rivière','Sauvage','Thibodeau','Vasseur'],
  },
  br: {
    first: ['João','Rafael','Thiago','Gustavo','Vinícius','Caio','Matheus','Bruno','Lucas','Igor','Danilo','Renan'],
    last: ['Albuquerque','Barreto','Cavalcanti','Damasceno','Figueira','Guimarães','Lacerda','Moreira','Nogueira','Pimentel','Rezende','Siqueira','Teixeira'],
  },
  nl: {
    first: ['Daan','Sem','Thijs','Bram','Joep','Stijn','Ruben','Jesse','Milan','Wout','Teun'],
    last: ['van Aalst','Bakhuis','de Clercq','Dijkhuizen','van Eerde','Groeneveld','Hoekstra','Jansma','Kuipers','van Leeuwen','Mulder','Oosterhout','Vermeulen'],
  },
  nord: {
    first: ['Erik','Magnus','Viktor','Oskar','Anders','Henrik','Elias','Jesper','Rasmus','Sindre','Aksel'],
    last: ['Bergqvist','Dahlberg','Ekström','Fjeldstad','Haugen','Lindahl','Nyborg','Rønning','Sandvik','Strand','Vestergaard'],
  },
  pl: {
    first: ['Kacper','Jakub','Mateusz','Bartosz','Szymon','Filip','Wiktor','Dawid','Patryk','Igor'],
    last: ['Borowiak','Czarnecki','Dąbrowski','Gajewski','Jabłoński','Kowalczuk','Lewandowicz','Nowacki','Pawlak','Sobczak','Wróblewski'],
  },
  af: {
    first: ['Kwame','Moussa','Ibrahima','Samuel','Yaw','Cheikh','Emmanuel','Kofi','Abdou','Victor','Seydou'],
    last: ['Adebayo','Bakayoko','Coulibaly','Diallo','Essien','Fofana','Kamara','Mensah','Ndiaye','Okafor','Sarr','Traoré'],
  },
};
export const NATIONS = [
  ['de', 'GER', 34], ['en', 'ENG', 8], ['es', 'ESP', 7], ['it', 'ITA', 6], ['fr', 'FRA', 7],
  ['br', 'BRA', 6], ['nl', 'NED', 7], ['nord', 'SWE', 6], ['pl', 'POL', 7], ['af', 'SEN', 7],
];

// Invented towns. Clubs are built from a town + a suffix.
export const TOWNS = ['Varnholm','Kessingford','Altmoor','Brennwick','Duskvale','Eastreach','Falkenrode','Greystrand','Hollowmere','Irongate','Juniper Bay','Kronfeld','Lowmarsh','Marrowick','Northwold','Oakhaven','Pellering','Quarryton','Ravensholt','Saltcombe','Thornbury Heath','Uhlenbruck','Vellmar Ost','Wyndham Cross','Ashgrove','Brightwater','Copperfield','Dornbach','Elmstead','Fenwick','Glimmersee','Harrowgate Vale','Ingleby','Jarlsberg','Kittering','Lindenhof'];
export const SUFFIXES = ['FC','United','Athletic','SV','Rovers','City','Wanderers','Albion','Sporting','Borussia 07','1899','Town','Real','Olympia','Union','Victoria','Rangers','SC'];
export const STADIUM_WORDS = ['Park','Arena','Ground','Stadium','Field','Bowl','Road','Lane','Kampfbahn','Stadion'];

// Kit palette: [primary, secondary]
export const KIT_COLORS = [
  ['#c8102e', '#ffffff'], ['#0b3d91', '#ffffff'], ['#ffd400', '#111111'], ['#1b7f3a', '#ffffff'], ['#5b2a86', '#f5c400'],
  ['#ffffff', '#0b3d91'], ['#111111', '#ffffff'], ['#e35205', '#1a1a1a'], ['#76b6e8', '#ffffff'], ['#7a1f2b', '#7fc7ff'],
  ['#ffffff', '#c8102e'], ['#004d40', '#ffd54f'], ['#d81b60', '#111111'], ['#0f2a5c', '#e2b13c'], ['#9e1b32', '#f2e6c9'],
  ['#2e7d32', '#ffeb3b'], ['#263238', '#ff7043'], ['#f2f2f2', '#2b2b2b'], ['#1565c0', '#ffca28'], ['#b71c1c', '#212121'],
  ['#00897b', '#ffffff'], ['#ff8f00', '#0d47a1'], ['#3949ab', '#e53935'], ['#6d4c41', '#ffe082'],
];
export const PATTERNS = ['plain', 'stripes', 'hoops', 'halves', 'sash', 'sleeves', 'pinstripe'];
export const CREST_SHAPES = ['shield', 'round', 'diamond', 'pointed', 'square'];

export const AD_BOARD_BRANDS = ['YOUR AD HERE', 'KESSEL COLA', 'NORDWIND ENERGY', 'PIXELBANK', 'BOLZPLATZ MANAGER PRO', 'GRÜNFELD BREWERY', 'VOLTA MOBILE', 'ORBIT TYRES', 'BLUEHARBOR INSURANCE'];
