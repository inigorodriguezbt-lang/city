// Deterministic citizen, business and place names. Everything is picked with
// hashes of building seeds so the same building always shows the same people.
import { hash3 } from '../core/rng';

export const FIRST_NAMES: readonly string[] = [
  // English / North American
  'Emma', 'Olivia', 'Ava', 'Sophia', 'Isabella', 'Mia', 'Charlotte', 'Amelia', 'Harper', 'Evelyn', 'Abigail', 'Emily', 'Ella', 'Grace',
  'Chloe', 'Lily', 'Hannah', 'Zoe', 'Nora', 'Riley', 'Audrey', 'Claire', 'Lucy', 'Ruby', 'Alice', 'Hazel', 'Violet', 'Stella', 'Maya',
  'Liam', 'Noah', 'Oliver', 'Elijah', 'James', 'William', 'Benjamin', 'Lucas', 'Henry', 'Theodore', 'Jack', 'Samuel', 'Owen', 'Wyatt',
  'Leo', 'Ethan', 'Mason', 'Logan', 'Caleb', 'Nathan', 'Isaac', 'Julian', 'Hudson', 'Miles', 'Eli', 'Adam', 'Ryan', 'Dylan', 'Grant',
  'Margaret', 'Dorothy', 'Frank', 'Walter', 'Harold', 'Edith', 'Arthur', 'Mabel', 'George', 'Rose', 'Ruth', 'Albert', 'Irene', 'Louis',
  // Spanish / Portuguese / Latin American
  'Sofía', 'Lucía', 'Valentina', 'Camila', 'Martina', 'Daniela', 'Paula', 'Carmen', 'Elena', 'Inés', 'Ximena', 'Renata', 'Beatriz',
  'Mateo', 'Santiago', 'Diego', 'Alejandro', 'Javier', 'Pablo', 'Miguel', 'Íñigo', 'Joaquín', 'Rafael', 'Andrés', 'Tomás', 'Gonzalo',
  'João', 'Thiago', 'Gabriel', 'Rodrigo', 'Afonso', 'Mariana', 'Leonor', 'Luana', 'Bruna', 'Caio', 'Iker', 'Nerea', 'Ainhoa', 'Unai',
  // French / Italian / German / Dutch
  'Camille', 'Léa', 'Manon', 'Chloé', 'Juliette', 'Louise', 'Hugo', 'Louis', 'Théo', 'Antoine', 'Mathis', 'Élodie', 'Margaux', 'Baptiste',
  'Giulia', 'Chiara', 'Francesca', 'Alessia', 'Martina', 'Lorenzo', 'Matteo', 'Leonardo', 'Francesco', 'Marco', 'Giovanni', 'Luca',
  'Hanna', 'Lena', 'Marie', 'Anna', 'Leonie', 'Felix', 'Maximilian', 'Jonas', 'Paul', 'Lukas', 'Moritz', 'Greta', 'Friedrich', 'Klara',
  'Sanne', 'Femke', 'Daan', 'Sem', 'Bram', 'Lotte', 'Joris', 'Maarten', 'Anouk', 'Ruben',
  // Nordic / Baltic / Slavic
  'Freja', 'Ingrid', 'Astrid', 'Saga', 'Linnea', 'Sigrid', 'Maja', 'Erik', 'Lars', 'Oskar', 'Nils', 'Magnus', 'Bjørn', 'Aksel', 'Elin',
  'Aino', 'Eino', 'Veera', 'Onni', 'Kaisa', 'Janis', 'Liga', 'Rasa', 'Tomas', 'Katarzyna', 'Zofia', 'Jakub', 'Piotr', 'Agnieszka',
  'Anastasia', 'Dmitri', 'Nikolai', 'Irina', 'Olga', 'Ivan', 'Milena', 'Luka', 'Nikola', 'Jelena', 'Petra', 'Ondřej', 'Tereza', 'Vesna',
  // Greek / Turkish / Middle East / North Africa
  'Eleni', 'Dimitris', 'Nikos', 'Sofia', 'Yannis', 'Katerina', 'Elif', 'Zeynep', 'Emre', 'Mehmet', 'Ayşe', 'Can', 'Deniz', 'Selin',
  'Omar', 'Layla', 'Yusuf', 'Fatima', 'Amira', 'Karim', 'Nour', 'Hassan', 'Rania', 'Zaid', 'Leila', 'Tariq', 'Salma', 'Khalid', 'Yasmin',
  'Dariush', 'Shirin', 'Arash', 'Parisa', 'Noa', 'Yael', 'Eitan', 'Tamar', 'Ariel', 'Avi',
  // Sub-Saharan Africa
  'Amara', 'Chidi', 'Ngozi', 'Kwame', 'Ama', 'Kofi', 'Abena', 'Tunde', 'Folake', 'Zanele', 'Thabo', 'Sipho', 'Nandi', 'Lerato', 'Kagiso',
  'Wanjiru', 'Otieno', 'Achieng', 'Baraka', 'Imani', 'Makena', 'Jabari', 'Adaeze', 'Obinna', 'Yaw', 'Efua', 'Mandla', 'Ayodele', 'Fola',
  // South Asia
  'Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Rohan', 'Ishaan', 'Kabir', 'Priya', 'Ananya', 'Diya', 'Aisha', 'Kavya', 'Meera', 'Riya', 'Sanjay',
  'Deepa', 'Nikhil', 'Pooja', 'Rahul', 'Sunita', 'Farhan', 'Nadia', 'Imran', 'Sadia', 'Tahmina', 'Nimal', 'Dilani', 'Sameera', 'Anil',
  // East & Southeast Asia
  'Wei', 'Jing', 'Mei', 'Li', 'Yan', 'Hao', 'Xin', 'Jun', 'Lin', 'Chen', 'Yuki', 'Haruto', 'Sakura', 'Ren', 'Aoi', 'Hina', 'Sota',
  'Minato', 'Yui', 'Kenji', 'Akiko', 'Takumi', 'Min-jun', 'Seo-yeon', 'Ji-woo', 'Ha-eun', 'Do-yun', 'Soo-ah', 'Jae-won',
  'Linh', 'Minh', 'Anh', 'Huong', 'Tuan', 'Thao', 'Somchai', 'Ploy', 'Niran', 'Malee', 'Rizal', 'Siti', 'Budi', 'Putri', 'Dewi',
  'Jose', 'Maria', 'Mark', 'Angelica', 'Paolo', 'Kristine',
  // Pacific / Indigenous / misc
  'Aroha', 'Tane', 'Moana', 'Keanu', 'Leilani', 'Kai', 'Mahina', 'Nalani', 'Wiremu', 'Ahanu', 'Takoda', 'Aiyana', 'Chenoa', 'Kiona',
  'Sasha', 'Robin', 'Alex', 'Jordan', 'Quinn', 'Avery', 'Rowan', 'Sage', 'Emerson', 'Finley', 'River', 'Skyler', 'Morgan', 'Jamie',
];

export const LAST_NAMES: readonly string[] = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Martin',
  'Jackson', 'Thompson', 'White', 'Harris', 'Clark', 'Lewis', 'Walker', 'Hall', 'Allen', 'Young', 'King', 'Wright', 'Scott', 'Green',
  'Baker', 'Adams', 'Nelson', 'Hill', 'Campbell', 'Mitchell', 'Roberts', 'Carter', 'Phillips', 'Evans', 'Turner', 'Parker', 'Collins',
  'Edwards', 'Stewart', 'Morris', 'Murphy', 'Cook', 'Rogers', 'Morgan', 'Cooper', 'Peterson', 'Reed', 'Bailey', 'Bell', 'Kelly',
  'Howard', 'Ward', 'Cox', 'Richardson', 'Wood', 'Watson', 'Brooks', 'Bennett', 'Gray', 'Hughes', 'Price', 'Sanders', 'Myers', 'Long',
  'O\'Brien', 'O\'Connor', 'McCarthy', 'Byrne', 'Doyle', 'Walsh', 'Gallagher', 'MacLeod', 'Fraser', 'Campbell', 'Sinclair', 'Lloyd',
  'García', 'Rodríguez', 'Martínez', 'Hernández', 'López', 'González', 'Pérez', 'Sánchez', 'Ramírez', 'Torres', 'Flores', 'Rivera',
  'Gómez', 'Díaz', 'Morales', 'Ortiz', 'Castillo', 'Romero', 'Navarro', 'Ruiz', 'Iglesias', 'Etxeberria', 'Aguirre', 'Zubiri',
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Costa', 'Pereira', 'Almeida', 'Ferreira', 'Carvalho', 'Ribeiro',
  'Martin', 'Bernard', 'Dubois', 'Durand', 'Lefebvre', 'Moreau', 'Laurent', 'Simon', 'Michel', 'Garnier', 'Fontaine', 'Rousseau',
  'Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Conti', 'De Luca', 'Moretti',
  'Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Hoffmann', 'Schulz', 'Koch', 'Richter', 'Wolf',
  'de Jong', 'Jansen', 'de Vries', 'van den Berg', 'Bakker', 'Visser', 'Smit', 'Mulder', 'Peeters', 'Maes', 'Claes',
  'Andersson', 'Johansson', 'Karlsson', 'Nilsson', 'Eriksson', 'Larsen', 'Hansen', 'Nielsen', 'Jensen', 'Olsen', 'Berg', 'Lindqvist',
  'Virtanen', 'Korhonen', 'Mäkinen', 'Nieminen', 'Jónsson', 'Sigurðardóttir',
  'Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Novák', 'Horváth', 'Ivanov', 'Petrov', 'Smirnov', 'Popescu', 'Kovačević', 'Jovanović',
  'Papadopoulos', 'Georgiou', 'Nikolaidis', 'Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Öztürk',
  'Haddad', 'Khalil', 'Nasser', 'Rahman', 'Hussein', 'Mansour', 'Aziz', 'Farouk', 'Saleh', 'Karimi', 'Hosseini', 'Tehrani', 'Cohen',
  'Levi', 'Mizrahi', 'Ben-David',
  'Okafor', 'Adeyemi', 'Mensah', 'Boateng', 'Owusu', 'Nkosi', 'Dlamini', 'Mokoena', 'Kamau', 'Mwangi', 'Odhiambo', 'Njoroge', 'Diallo',
  'Traoré', 'Keita', 'Ndiaye', 'Abebe', 'Tesfaye', 'Okonkwo', 'Eze', 'Balogun',
  'Patel', 'Sharma', 'Singh', 'Kumar', 'Gupta', 'Iyer', 'Reddy', 'Nair', 'Das', 'Mehta', 'Chopra', 'Kapoor', 'Joshi', 'Bose', 'Khan',
  'Chowdhury', 'Hossain', 'Perera', 'Fernando', 'Silva',
  'Wang', 'Li', 'Zhang', 'Liu', 'Chen', 'Yang', 'Huang', 'Zhao', 'Wu', 'Zhou', 'Xu', 'Sun', 'Ma', 'Zhu', 'Hu', 'Lin', 'Guo', 'He',
  'Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada',
  'Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Jang', 'Lim',
  'Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Vu', 'Dang', 'Bui', 'Srisai', 'Wongsa', 'Santoso', 'Wijaya', 'Hidayat', 'Reyes', 'Cruz',
  'Bautista', 'Mendoza', 'Aquino',
  'Ngata', 'Parata', 'Kealoha', 'Kahale', 'Tuilagi', 'Blackfeather', 'Redcloud', 'Morningstar', 'Whitehorse', 'Littlewolf',
];

/** Occupations by broad category (used for people lists in the building inspector). */
export const OCCUPATIONS: Record<'res' | 'com' | 'ind' | 'off' | 'farm' | 'forest' | 'mine' | 'oil' | 'svc' | 'student' | 'retired' | 'child', readonly string[]> = {
  res: ['Nurse', 'Teacher', 'Electrician', 'Barista', 'Software developer', 'Bus driver', 'Chef', 'Architect', 'Plumber', 'Accountant',
    'Graphic designer', 'Mechanic', 'Pharmacist', 'Journalist', 'Carpenter', 'Paramedic', 'Librarian', 'Photographer', 'Lawyer', 'Baker',
    'Firefighter', 'Social worker', 'Musician', 'Dentist', 'Hairdresser', 'Postal worker', 'Translator', 'Engineer', 'Florist', 'Pilot'],
  com: ['Shop assistant', 'Store manager', 'Cashier', 'Waiter', 'Bartender', 'Sales clerk', 'Cook', 'Butcher', 'Tailor', 'Bookseller',
    'Pharmacist', 'Optician', 'Barber', 'Sommelier', 'Stock clerk', 'Delivery rider', 'Florist', 'Jeweller', 'Baker', 'Hotel receptionist'],
  ind: ['Machinist', 'Welder', 'Forklift driver', 'Line supervisor', 'Quality inspector', 'Warehouse worker', 'Truck driver', 'Electrician',
    'Chemist', 'Maintenance tech', 'Assembler', 'Packer', 'Safety officer', 'Logistics planner', 'Crane operator', 'Metalworker'],
  off: ['Analyst', 'Project manager', 'Software engineer', 'Consultant', 'Data scientist', 'Designer', 'Account manager', 'HR specialist',
    'Marketing lead', 'Lawyer', 'Architect', 'Economist', 'Product owner', 'Recruiter', 'Researcher', 'Executive assistant', 'CFO', 'Intern'],
  farm: ['Farmer', 'Tractor driver', 'Agronomist', 'Harvest hand', 'Dairy worker', 'Beekeeper', 'Orchard keeper', 'Seed technician'],
  forest: ['Lumberjack', 'Sawmill operator', 'Forester', 'Log truck driver', 'Arborist', 'Carpenter', 'Timber grader'],
  mine: ['Miner', 'Blaster', 'Geologist', 'Excavator operator', 'Surveyor', 'Conveyor tech', 'Mine foreman'],
  oil: ['Roughneck', 'Driller', 'Petroleum engineer', 'Pipeline tech', 'Refinery operator', 'Tank truck driver', 'Rig manager'],
  svc: ['Doctor', 'Nurse', 'Teacher', 'Police officer', 'Firefighter', 'Technician', 'Clerk', 'Janitor', 'Manager', 'Paramedic',
    'Engineer', 'Operator', 'Groundskeeper', 'Driver', 'Researcher', 'Security guard'],
  student: ['Student', 'University student', 'High-school student', 'PhD candidate', 'Apprentice', 'Exchange student'],
  retired: ['Retired teacher', 'Retired engineer', 'Retired nurse', 'Pensioner', 'Retired sailor', 'Retired baker', 'Retired judge'],
  child: ['Pupil', 'Toddler', 'Kindergartner', 'Primary schooler'],
};

// ── business & place name parts ─────────────────────────────────────────────
export const STREET_WORDS: readonly string[] = [
  'Maple', 'Oak', 'Willow', 'Cedar', 'Birch', 'Elm', 'Chestnut', 'Linden', 'Juniper', 'Aspen', 'Harbor', 'Mill', 'Station', 'Market',
  'Church', 'Park', 'River', 'Lake', 'Hill', 'Meadow', 'Orchard', 'Garden', 'Bridge', 'Castle', 'Victoria', 'King', 'Queen', 'Union',
  'Liberty', 'Sunset', 'Highland', 'Brook', 'Spring', 'Rose', 'Lavender', 'Olive', 'Cypress', 'Magnolia', 'Stone', 'Copper', 'Silver',
  'Golden', 'Crescent', 'Beacon', 'Lantern', 'Falcon', 'Heron', 'Swallow', 'Fox', 'Wren', 'Juniper', 'Harvest', 'Mariner', 'Pioneer',
];

export const RES_SUFFIX_LOW: readonly string[] = ['Cottage', 'House', 'Villa', 'Home', 'Lodge', 'Bungalow', 'Farmhouse', 'Cabin', 'Townhouse', 'Row'];
export const RES_SUFFIX_MED: readonly string[] = ['Court', 'Terrace', 'Mews', 'Residences', 'Apartments', 'Gardens', 'Place', 'Walk', 'Yard', 'Close'];
export const RES_SUFFIX_HIGH: readonly string[] = ['Tower', 'Heights', 'Plaza', 'Point', 'One', 'Skyline', 'Pinnacle', 'Residences', 'Lofts', 'Vista'];

export const SHOP_KINDS: readonly string[] = [
  'Bakery', 'Café', 'Books', 'Grocers', 'Hardware', 'Deli', 'Bistro', 'Florist', 'Pharmacy', 'Tailors', 'Bicycles', 'Records', 'Toys',
  'Barbers', 'Wine Bar', 'Noodle House', 'Taquería', 'Pizzeria', 'Sushi Bar', 'Tea Room', 'Boutique', 'Opticians', 'Gelato', 'Diner',
  'Launderette', 'Pet Shop', 'Stationers', 'Butchers', 'Fishmongers', 'Cheese Shop', 'Kebab House', 'Curry House', 'Ramen Bar',
];
export const MALL_KINDS: readonly string[] = ['Department Store', 'Galleria', 'Shopping Centre', 'Market Hall', 'Arcade', 'Emporium', 'Hotel', 'Megastore', 'Food Hall', 'Cinema'];
export const OFFICE_WORDS: readonly string[] = [
  'Nimbus', 'Vertex', 'Quantum', 'Helix', 'Summit', 'Meridian', 'Zenith', 'Atlas', 'Orion', 'Lumen', 'Nova', 'Cobalt', 'Aurora', 'Apex',
  'Sterling', 'Pinnacle', 'Horizon', 'Keystone', 'Silverline', 'Bluewave', 'Brightpath', 'Northstar', 'Evergreen', 'Ironbridge',
];
export const OFFICE_KINDS: readonly string[] = ['Holdings', 'Group', 'Labs', 'Partners', 'Capital', 'Systems', 'Consulting', 'Analytics', 'Insurance', 'Media', 'Bank', 'Ventures', 'Biotech', 'Software'];
export const IND_KINDS: readonly string[] = ['Works', 'Manufacturing', 'Plastics', 'Steel', 'Textiles', 'Logistics', 'Foods', 'Chemicals', 'Electronics', 'Motors', 'Packaging', 'Brewery', 'Glassworks', 'Tools'];
export const FARM_KINDS: readonly string[] = ['Farm', 'Orchard', 'Ranch', 'Dairy', 'Vineyard', 'Homestead', 'Acres', 'Greenhouses'];
export const FOREST_KINDS: readonly string[] = ['Sawmill', 'Timber Co.', 'Lumber Yard', 'Woodworks', 'Forestry'];
export const MINE_KINDS: readonly string[] = ['Quarry', 'Mine', 'Mining Co.', 'Aggregates', 'Ore Works'];
export const OIL_KINDS: readonly string[] = ['Oil Field', 'Petroleum', 'Drilling', 'Energy', 'Refinery'];

/** Deterministic pick from a list by up to three integer keys. */
export function pickName<T>(list: readonly T[], a: number, b = 0, c = 0): T {
  return list[hash3(a | 0, b | 0, c | 0) % list.length];
}

export function firstName(seed: number, i: number): string {
  return pickName(FIRST_NAMES, seed, i, 0x51);
}

export function lastName(seed: number, i: number): string {
  return pickName(LAST_NAMES, seed, i, 0xa7);
}

/** "First Last" for (seed, index) — the same arguments always give the same person. */
export function personName(seed: number, i: number): string {
  return `${firstName(seed, i)} ${lastName(seed, i)}`;
}

/** Short social-media style handle for a person. */
export function handleOf(name: string, seed: number): string {
  const [f, ...rest] = name.split(' ');
  const l = rest.join('');
  const base = (f + (hash3(seed, 3, 9) % 3 === 0 ? '_' : '') + l).normalize('NFD').replace(/[^A-Za-z0-9_]/g, '');
  const n = hash3(seed, 7, 13) % 4 === 0 ? String(hash3(seed, 1, 2) % 99) : '';
  return '@' + base + n;
}
