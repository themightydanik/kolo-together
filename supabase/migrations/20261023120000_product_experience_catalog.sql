-- Additive editorial release. No published card/answer/deck is rewritten.
begin;
alter table public.connection_sessions add column game_catalog_version integer not null default 1 check(game_catalog_version in (1,2));
-- Existing (including pending) games stay pinned to v1. Only new sessions use v2.
alter table public.connection_sessions alter column game_catalog_version set default 2;
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-01',2,$catalog${"id": "us-v2-01", "category": "us", "text": "Коли ти вперше подумав(-ла), що з нами може вийти щось особливе?", "version": 2, "previous_id": "us-01"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-02',2,$catalog${"id": "us-v2-02", "category": "us", "text": "Яка дрібниця вдома нагадує тобі про нас?", "version": 2, "previous_id": "us-02"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-03',2,$catalog${"id": "us-v2-03", "category": "us", "text": "Згадай наш день, коли нічого особливого не сталося, але було дуже добре. Що в ньому було?", "version": 2, "previous_id": "us-03"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-04',2,$catalog${"id": "us-v2-04", "category": "us", "text": "Куди з наших спільних прогулянок тобі хочеться повернутися?", "version": 2, "previous_id": "us-04"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-05',2,$catalog${"id": "us-v2-05", "category": "us", "text": "Яка моя звичка спершу дивувала, а тепер здається рідною?", "version": 2, "previous_id": "us-05"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-06',2,$catalog${"id": "us-v2-06", "category": "us", "text": "Почувши яку пісню, ти одразу згадуєш нас?", "version": 2, "previous_id": "us-06"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-07',2,$catalog${"id": "us-v2-07", "category": "us", "text": "Що ми навчилися робити разом краще, ніж окремо?", "version": 2, "previous_id": "us-07"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-08',2,$catalog${"id": "us-v2-08", "category": "us", "text": "Над яким нашим невдалим планом ти досі смієшся?", "version": 2, "previous_id": "us-08"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-09',2,$catalog${"id": "us-v2-09", "category": "us", "text": "Яку спільну фотографію ти показав(-ла) б нам через двадцять років?", "version": 2, "previous_id": "us-09"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-10',2,$catalog${"id": "us-v2-10", "category": "us", "text": "Що я роблю такого, від чого ти мимоволі усміхаєшся?", "version": 2, "previous_id": "us-10"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-11',2,$catalog${"id": "us-v2-11", "category": "us", "text": "Де ти хотів(-ла) б зустріти зі мною світанок?", "version": 2, "previous_id": "us-11"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-12',2,$catalog${"id": "us-v2-12", "category": "us", "text": "Яка наша маленька традиція заслуговує на продовження?", "version": 2, "previous_id": "us-12"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-13',2,$catalog${"id": "us-v2-13", "category": "us", "text": "Що в мені приємно здивувало тебе з часом?", "version": 2, "previous_id": "us-13"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-14',2,$catalog${"id": "us-v2-14", "category": "us", "text": "Якби ми зняли комедію про наше життя, яка сцена обов’язково мала б до неї потрапити?", "version": 2, "previous_id": "us-14"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-15',2,$catalog${"id": "us-v2-15", "category": "us", "text": "Яку страву ти пов’язуєш із нами?", "version": 2, "previous_id": "us-15"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-16',2,$catalog${"id": "us-v2-16", "category": "us", "text": "Про що ми колись сперечалися, а тепер обоє згадуємо з усмішкою?", "version": 2, "previous_id": "us-16"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-17',2,$catalog${"id": "us-v2-17", "category": "us", "text": "Який день удвох ти хотів(-ла) б пережити повільніше?", "version": 2, "previous_id": "us-17"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-18',2,$catalog${"id": "us-v2-18", "category": "us", "text": "Коли нам було добре просто мовчати поруч?", "version": 2, "previous_id": "us-18"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-19',2,$catalog${"id": "us-v2-19", "category": "us", "text": "Який невеликий подарунок від мене залишив теплий спогад?", "version": 2, "previous_id": "us-19"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-20',2,$catalog${"id": "us-v2-20", "category": "us", "text": "Що з нашого першого побачення ти пам’ятаєш, а я міг(-ла) вже забути?", "version": 2, "previous_id": "us-20"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-21',2,$catalog${"id": "us-v2-21", "category": "us", "text": "Як би ми провели суботу, якби сьогодні зникли всі плани?", "version": 2, "previous_id": "us-21"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-22',2,$catalog${"id": "us-v2-22", "category": "us", "text": "Чого тобі хотілося б уперше навчитися разом зі мною?", "version": 2, "previous_id": "us-22"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-23',2,$catalog${"id": "us-v2-23", "category": "us", "text": "Який момент змусив тебе подумати: «Ми впоралися»?", "version": 2, "previous_id": "us-23"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-24',2,$catalog${"id": "us-v2-24", "category": "us", "text": "На яку тему наші розмови завжди тривають довше, ніж ми планували?", "version": 2, "previous_id": "us-24"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-25',2,$catalog${"id": "us-v2-25", "category": "us", "text": "Про що ти мрієш сказати нам через рік: «Як добре, що ми це зробили»?", "version": 2, "previous_id": "us-25"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-26',2,$catalog${"id": "us-v2-26", "category": "us", "text": "Згадай нашу найбезглуздішу покупку. Чому вона досі нам подобається або чим нас навчила?", "version": 2, "previous_id": "us-26"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-27',2,$catalog${"id": "us-v2-27", "category": "us", "text": "Який маршрут містом став для тебе нашим?", "version": 2, "previous_id": "us-27"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-28',2,$catalog${"id": "us-v2-28", "category": "us", "text": "Яке моє повідомлення було особливо вчасним?", "version": 2, "previous_id": "us-28"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-29',2,$catalog${"id": "us-v2-29", "category": "us", "text": "Що з того, як ми проводимо час разом, тобі хотілося б зберегти надовго?", "version": 2, "previous_id": "us-29"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-v2-30',2,$catalog${"id": "us-v2-30", "category": "us", "text": "Що приємне й просте ми могли б зробити разом найближчими днями?", "version": 2, "previous_id": "us-30"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-01',2,$catalog${"id": "dessert-v2-01", "category": "dessert", "text": "Яку романтичну записку тобі було б приємно знайти в кишені?", "version": 2, "previous_id": "dessert-01"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-02',2,$catalog${"id": "dessert-v2-02", "category": "dessert", "text": "Уяви: у нас лише година на побачення й дві чашки кави. Куди запросиш мене?", "version": 2, "previous_id": "dessert-02"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-03',2,$catalog${"id": "dessert-v2-03", "category": "dessert", "text": "Під яку пісню ти хотів(-ла) б потанцювати зі мною на кухні?", "version": 2, "previous_id": "dessert-03"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-04',2,$catalog${"id": "dessert-v2-04", "category": "dessert", "text": "Який комплімент від мене ти хотів(-ла) б почути сьогодні?", "version": 2, "previous_id": "dessert-04"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-05',2,$catalog${"id": "dessert-v2-05", "category": "dessert", "text": "У чому ти запросив(-ла) б мене на побачення, щоб трохи здивувати?", "version": 2, "previous_id": "dessert-05"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-06',2,$catalog${"id": "dessert-v2-06", "category": "dessert", "text": "Куди ти запросив(-ла) б мене, якби ми щойно познайомилися?", "version": 2, "previous_id": "dessert-06"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-07',2,$catalog${"id": "dessert-v2-07", "category": "dessert", "text": "Чим має пахнути наше ідеальне ліниве побачення: кавою, морем чи чимось зовсім іншим?", "version": 2, "previous_id": "dessert-07"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-08',2,$catalog${"id": "dessert-v2-08", "category": "dessert", "text": "Як би ти познайомився(-лася) зі мною сьогодні, якби я сидів(-ла) за сусіднім столиком?", "version": 2, "previous_id": "dessert-08"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-09',2,$catalog${"id": "dessert-v2-09", "category": "dessert", "text": "Якби ми влаштували пікнік у кімнаті, що було б у кошику?", "version": 2, "previous_id": "dessert-09"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-10',2,$catalog${"id": "dessert-v2-10", "category": "dessert", "text": "Який танець ти спробував(-ла) б зі мною без глядачів?", "version": 2, "previous_id": "dessert-10"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-11',2,$catalog${"id": "dessert-v2-11", "category": "dessert", "text": "Хто з нас краще влаштував би побачення-сюрприз і чому?", "version": 2, "previous_id": "dessert-11"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-12',2,$catalog${"id": "dessert-v2-12", "category": "dessert", "text": "Як ти любиш отримувати запрошення на побачення?", "version": 2, "previous_id": "dessert-12"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-13',2,$catalog${"id": "dessert-v2-13", "category": "dessert", "text": "Що перетворює звичайну вечерю на романтичну?", "version": 2, "previous_id": "dessert-13"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-14',2,$catalog${"id": "dessert-v2-14", "category": "dessert", "text": "Коли я востаннє змусив(-ла) тебе ніяково усміхнутися?", "version": 2, "previous_id": "dessert-14"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-15',2,$catalog${"id": "dessert-v2-15", "category": "dessert", "text": "Придумай нам таємний знак, який на людях означатиме: «Хочу побути з тобою вдвох». Який він?", "version": 2, "previous_id": "dessert-15"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-16',2,$catalog${"id": "dessert-v2-16", "category": "dessert", "text": "Що ти обрав(-ла) б: побачення на даху чи біля води, і чому?", "version": 2, "previous_id": "dessert-16"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-17',2,$catalog${"id": "dessert-v2-17", "category": "dessert", "text": "Який навмисно безглуздий комплімент міг би мене розсмішити?", "version": 2, "previous_id": "dessert-17"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-18',2,$catalog${"id": "dessert-v2-18", "category": "dessert", "text": "Збираємося на вечірнє побачення. Що ти обрав(-ла) б для мене з мого гардероба?", "version": 2, "previous_id": "dessert-18"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-19',2,$catalog${"id": "dessert-v2-19", "category": "dessert", "text": "Яке кіношне побачення ти переробив(-ла) б під нас?", "version": 2, "previous_id": "dessert-19"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-20',2,$catalog${"id": "dessert-v2-20", "category": "dessert", "text": "Що романтичне можна зробити для тебе за п’ять хвилин зранку?", "version": 2, "previous_id": "dessert-20"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-21',2,$catalog${"id": "dessert-v2-21", "category": "dessert", "text": "Що тобі приємніше: сюрприз із підказкою чи чіткий план?", "version": 2, "previous_id": "dessert-21"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-22',2,$catalog${"id": "dessert-v2-22", "category": "dessert", "text": "Яку страву було б весело готувати вдвох під музику?", "version": 2, "previous_id": "dessert-22"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-23',2,$catalog${"id": "dessert-v2-23", "category": "dessert", "text": "Як би виглядало наше побачення без жодного екрана?", "version": 2, "previous_id": "dessert-23"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-24',2,$catalog${"id": "dessert-v2-24", "category": "dessert", "text": "На один вечір я стаю твоїм особистим гідом. Яке місце ти попросиш мені показати?", "version": 2, "previous_id": "dessert-24"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-25',2,$catalog${"id": "dessert-v2-25", "category": "dessert", "text": "Який романтичний жест на відстані тобі близький?", "version": 2, "previous_id": "dessert-25"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-26',2,$catalog${"id": "dessert-v2-26", "category": "dessert", "text": "Якби наше наступне побачення мало назву, що було б на запрошенні?", "version": 2, "previous_id": "dessert-26"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-27',2,$catalog${"id": "dessert-v2-27", "category": "dessert", "text": "Яку приємну витівку можна вигадати для дощового дня?", "version": 2, "previous_id": "dessert-27"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-28',2,$catalog${"id": "dessert-v2-28", "category": "dessert", "text": "Як ти любиш, щоб закінчувалося вдале побачення?", "version": 2, "previous_id": "dessert-28"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-29',2,$catalog${"id": "dessert-v2-29", "category": "dessert", "text": "Яке місце в нашому місті має недооцінений романтичний потенціал?", "version": 2, "previous_id": "dessert-29"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-v2-30',2,$catalog${"id": "dessert-v2-30", "category": "dessert", "text": "Який маленький сюрприз ти залишив(-ла) б мені на звичайний вівторок?", "version": 2, "previous_id": "dessert-30"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-01',2,$catalog${"id": "trust-v2-01", "category": "trust", "text": "Коли тобі востаннє було важко попросити мене про допомогу?", "version": 2, "previous_id": "trust-01"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-02',2,$catalog${"id": "trust-v2-02", "category": "trust", "text": "Що ти зазвичай приховуєш за словами «все нормально»?", "version": 2, "previous_id": "trust-02"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-03',2,$catalog${"id": "trust-v2-03", "category": "trust", "text": "Які мої слова колись підтримали тебе сильніше, ніж я міг(-ла) здогадуватися?", "version": 2, "previous_id": "trust-03"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-04',2,$catalog${"id": "trust-v2-04", "category": "trust", "text": "За що ти вдячний(-а) собі, але рідко говориш про це вголос?", "version": 2, "previous_id": "trust-04"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-05',2,$catalog${"id": "trust-v2-05", "category": "trust", "text": "Чого ти боявся(-лася) на початку наших стосунків і як ставишся до цього зараз?", "version": 2, "previous_id": "trust-05"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-06',2,$catalog${"id": "trust-v2-06", "category": "trust", "text": "Про що тобі легше написати, ніж сказати мені наживо?", "version": 2, "previous_id": "trust-06"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-07',2,$catalog${"id": "trust-v2-07", "category": "trust", "text": "Коли ти відчуваєш, що я справді тебе розумію?", "version": 2, "previous_id": "trust-07"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-08',2,$catalog${"id": "trust-v2-08", "category": "trust", "text": "Яке вибачення у своєму житті ти запам’ятав(-ла) найбільше?", "version": 2, "previous_id": "trust-08"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-09',2,$catalog${"id": "trust-v2-09", "category": "trust", "text": "У чому тобі хотілося б мати право не бути сильним(-ою) поруч зі мною?", "version": 2, "previous_id": "trust-09"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-10',2,$catalog${"id": "trust-v2-10", "category": "trust", "text": "Чи є щось, про що ти передумав(-ла), але ще не встиг(-ла) мені розповісти?", "version": 2, "previous_id": "trust-10"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-11',2,$catalog${"id": "trust-v2-11", "category": "trust", "text": "Що люди часто неправильно розуміють у твоєму характері?", "version": 2, "previous_id": "trust-11"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-12',2,$catalog${"id": "trust-v2-12", "category": "trust", "text": "Як я можу дбайливо реагувати на твоє «ні»?", "version": 2, "previous_id": "trust-12"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-13',2,$catalog${"id": "trust-v2-13", "category": "trust", "text": "Який недавній маленький успіх був для тебе насправді великим?", "version": 2, "previous_id": "trust-13"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-14',2,$catalog${"id": "trust-v2-14", "category": "trust", "text": "Коли ти пишався(-лася) нами, але нічого не сказав(-ла)?", "version": 2, "previous_id": "trust-14"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-15',2,$catalog${"id": "trust-v2-15", "category": "trust", "text": "Яка твоя невпевненість стає меншою поруч зі мною?", "version": 2, "previous_id": "trust-15"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-16',2,$catalog${"id": "trust-v2-16", "category": "trust", "text": "Що ти хотів(-ла) б, щоб я знав(-ла) про твій досвід до нашого знайомства?", "version": 2, "previous_id": "trust-16"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-17',2,$catalog${"id": "trust-v2-17", "category": "trust", "text": "Кому, крім мене, тобі легко довіряти і завдяки чому?", "version": 2, "previous_id": "trust-17"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-18',2,$catalog${"id": "trust-v2-18", "category": "trust", "text": "Що з твоїх переживань зараз не потребує поради, а лише уважного слухання?", "version": 2, "previous_id": "trust-18"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-19',2,$catalog${"id": "trust-v2-19", "category": "trust", "text": "У який момент моя турбота була не зовсім такою, як тобі хотілося?", "version": 2, "previous_id": "trust-19"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-20',2,$catalog${"id": "trust-v2-20", "category": "trust", "text": "Яка сімейна звичка впливає на тебе сильніше, ніж здається іншим?", "version": 2, "previous_id": "trust-20"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-21',2,$catalog${"id": "trust-v2-21", "category": "trust", "text": "Коли тобі найважче повірити компліменту від мене?", "version": 2, "previous_id": "trust-21"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-22',2,$catalog${"id": "trust-v2-22", "category": "trust", "text": "Про яку нашу складну розмову ти думаєш: «Добре, що ми її не відклали»?", "version": 2, "previous_id": "trust-22"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-23',2,$catalog${"id": "trust-v2-23", "category": "trust", "text": "У чому ти сьогодні відчуваєш себе іншою людиною, ніж рік тому?", "version": 2, "previous_id": "trust-23"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-24',2,$catalog${"id": "trust-v2-24", "category": "trust", "text": "Якою своєю рисою ти дорожиш, навіть якщо вона іноді ускладнює нам життя?", "version": 2, "previous_id": "trust-24"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-25',2,$catalog${"id": "trust-v2-25", "category": "trust", "text": "Коли добре мовчання підтримує тебе краще за слова?", "version": 2, "previous_id": "trust-25"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-26',2,$catalog${"id": "trust-v2-26", "category": "trust", "text": "Яке непорозуміння між нами навчило тебе чогось важливого?", "version": 2, "previous_id": "trust-26"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-27',2,$catalog${"id": "trust-v2-27", "category": "trust", "text": "Про що тобі зараз цікаво запитати мене, але ти не знаходив(-ла) нагоди?", "version": 2, "previous_id": "trust-27"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-28',2,$catalog${"id": "trust-v2-28", "category": "trust", "text": "Що допомагає тобі просити про допомогу без почуття боргу?", "version": 2, "previous_id": "trust-28"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-29',2,$catalog${"id": "trust-v2-29", "category": "trust", "text": "Яку надію щодо нас ти бережеш для себе?", "version": 2, "previous_id": "trust-29"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-v2-30',2,$catalog${"id": "trust-v2-30", "category": "trust", "text": "Що могло б зробити нашу наступну щиру розмову трохи легшою?", "version": 2, "previous_id": "trust-30"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-01',2,$catalog${"id": "heat-v2-01", "category": "heat", "text": "Який наш поцілунок ти хотів(-ла) б згадати в усіх найприємніших подробицях?", "version": 2, "previous_id": "heat-01"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-02',2,$catalog${"id": "heat-v2-02", "category": "heat", "text": "У якому моєму образі тобі найважче приховати усмішку захоплення?", "version": 2, "previous_id": "heat-02"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-03',2,$catalog${"id": "heat-v2-03", "category": "heat", "text": "Який мій несподіваний жест колись змусив твоє серце забитися швидше?", "version": 2, "previous_id": "heat-03"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-04',2,$catalog${"id": "heat-v2-04", "category": "heat", "text": "Як би ти почав(-ла) флірт зі мною, якби ми сьогодні зустрілися в готельному барі?", "version": 2, "previous_id": "heat-04"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-05',2,$catalog${"id": "heat-v2-05", "category": "heat", "text": "Згадай наш вечір, коли між нами іскрило ще до першого дотику. Що створило той настрій?", "version": 2, "previous_id": "heat-05"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-06',2,$catalog${"id": "heat-v2-06", "category": "heat", "text": "Які слова від мене могли б перетворити звичайне повідомлення на спокусливе запрошення до розмови?", "version": 2, "previous_id": "heat-06"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-07',2,$catalog${"id": "heat-v2-07", "category": "heat", "text": "Який повільний танець ти уявляєш для нас, коли за вікном уже стемніло?", "version": 2, "previous_id": "heat-07"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-08',2,$catalog${"id": "heat-v2-08", "category": "heat", "text": "Коли мій голос або сміх здається тобі особливо привабливим?", "version": 2, "previous_id": "heat-08"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-09',2,$catalog${"id": "heat-v2-09", "category": "heat", "text": "Ми в будиночку далеко від міста, увечері почався дощ. Яким ти уявляєш наш час удвох?", "version": 2, "previous_id": "heat-09"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-10',2,$catalog${"id": "heat-v2-10", "category": "heat", "text": "Яка деталь у моїй зовнішності приємно відволікає тебе навіть після довгого знайомства?", "version": 2, "previous_id": "heat-10"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-11',2,$catalog${"id": "heat-v2-11", "category": "heat", "text": "Який наш ніжний момент ти продовжив(-ла) б ще на кілька хвилин?", "version": 2, "previous_id": "heat-11"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-12',2,$catalog${"id": "heat-v2-12", "category": "heat", "text": "Яку грайливу фразу ти прошепотів(-ла) б мені під час побачення?", "version": 2, "previous_id": "heat-12"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-13',2,$catalog${"id": "heat-v2-13", "category": "heat", "text": "Що тобі найбільше подобається в передчутті близькості між нами?", "version": 2, "previous_id": "heat-13"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-14',2,$catalog${"id": "heat-v2-14", "category": "heat", "text": "Заплющ очі й уяви вечір для нас: яке там світло, музика й аромат?", "version": 2, "previous_id": "heat-14"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-15',2,$catalog${"id": "heat-v2-15", "category": "heat", "text": "Яке бажання про наш час удвох тобі було б приємно озвучити без обіцянки його здійснення?", "version": 2, "previous_id": "heat-15"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-16',2,$catalog${"id": "heat-v2-16", "category": "heat", "text": "Яке моє зізнання про твою привабливість ти хотів(-ла) б почути наодинці?", "version": 2, "previous_id": "heat-16"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-17',2,$catalog${"id": "heat-v2-17", "category": "heat", "text": "Якби ти готував(-ла) для мене романтичний квест, якою була б перша підказка?", "version": 2, "previous_id": "heat-17"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-18',2,$catalog${"id": "heat-v2-18", "category": "heat", "text": "Який приємний спільний досвід ти повторив(-ла) б у зовсім іншій атмосфері?", "version": 2, "previous_id": "heat-18"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-19',2,$catalog${"id": "heat-v2-19", "category": "heat", "text": "Який поцілунок для тебе найромантичніший: несподіваний, довгоочікуваний чи після щирої розмови?", "version": 2, "previous_id": "heat-19"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-20',2,$catalog${"id": "heat-v2-20", "category": "heat", "text": "Як виглядав би наш ідеальний ранок після вечора, який нікуди не поспішав?", "version": 2, "previous_id": "heat-20"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-21',2,$catalog${"id": "heat-v2-21", "category": "heat", "text": "Як ти розумієш із мого погляду, що я з тобою фліртую?", "version": 2, "previous_id": "heat-21"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-22',2,$catalog${"id": "heat-v2-22", "category": "heat", "text": "Яку фантазію про романтичну подорож ти охоче обговорив(-ла) б зі мною?", "version": 2, "previous_id": "heat-22"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-23',2,$catalog${"id": "heat-v2-23", "category": "heat", "text": "Яка маленька зміна в обстановці могла б додати новизни нашому часу наодинці?", "version": 2, "previous_id": "heat-23"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-24',2,$catalog${"id": "heat-v2-24", "category": "heat", "text": "Який комплімент про твою чуттєвість звучав би для тебе природно й приємно?", "version": 2, "previous_id": "heat-24"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-25',2,$catalog${"id": "heat-v2-25", "category": "heat", "text": "У який момент між нами ти відчуваєш найсильнішу суміш ніжності та бажання?", "version": 2, "previous_id": "heat-25"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-26',2,$catalog${"id": "heat-v2-26", "category": "heat", "text": "Який затишний ритуал після близькості тобі хотілося б зберегти для нас?", "version": 2, "previous_id": "heat-26"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-27',2,$catalog${"id": "heat-v2-27", "category": "heat", "text": "Яку грайливу підказку ти залишив(-ла) б мені перед побаченням, щоб я весь день чекав(-ла) вечора?", "version": 2, "previous_id": "heat-27"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-28',2,$catalog${"id": "heat-v2-28", "category": "heat", "text": "Яка моя риса приваблює тебе так, як не могла б передати жодна фотографія?", "version": 2, "previous_id": "heat-28"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-29',2,$catalog${"id": "heat-v2-29", "category": "heat", "text": "Про яку нову романтичну ідею тобі цікаво просто помріяти разом, залишивши право нічого не втілювати?", "version": 2, "previous_id": "heat-29"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-v2-30',2,$catalog${"id": "heat-v2-30", "category": "heat", "text": "Що допомогло б нам зберегти приємне передчуття наступної зустрічі після сьогоднішнього вечора?", "version": 2, "previous_id": "heat-30"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-01',2,$catalog${"id": "secret-v2-01", "category": "secret", "text": "Яке своє бажання ти досі відкладаєш, бо воно здається «несерйозним»?", "version": 2, "previous_id": "secret-01"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-02',2,$catalog${"id": "secret-v2-02", "category": "secret", "text": "Чи є маленька мрія, яку ти хотів(-ла) б довірити мені сьогодні?", "version": 2, "previous_id": "secret-02"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-03',2,$catalog${"id": "secret-v2-03", "category": "secret", "text": "Що ти купив(-ла) б собі просто для радості, не пояснюючи нікому навіщо?", "version": 2, "previous_id": "secret-03"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-04',2,$catalog${"id": "secret-v2-04", "category": "secret", "text": "Яким ти уявляєш наше життя, коли ніхто не питає про практичність планів?", "version": 2, "previous_id": "secret-04"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-05',2,$catalog${"id": "secret-v2-05", "category": "secret", "text": "Куди тобі хотілося б утекти зі мною на кілька днів без великої програми?", "version": 2, "previous_id": "secret-05"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-06',2,$catalog${"id": "secret-v2-06", "category": "secret", "text": "Чому ти потай заздриш у людях, якими захоплюєшся?", "version": 2, "previous_id": "secret-06"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-07',2,$catalog${"id": "secret-v2-07", "category": "secret", "text": "Яка частина твого характеру рідко помітна іншим?", "version": 2, "previous_id": "secret-07"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-08',2,$catalog${"id": "secret-v2-08", "category": "secret", "text": "Що ти любиш робити, коли вдома зовсім один(-на)?", "version": 2, "previous_id": "secret-08"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-09',2,$catalog${"id": "secret-v2-09", "category": "secret", "text": "Яку свою дитячу мрію ти досі не готовий(-а) списати з рахунків?", "version": 2, "previous_id": "secret-09"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-10',2,$catalog${"id": "secret-v2-10", "category": "secret", "text": "Про яку сторону твого життя я, можливо, знаю менше, ніж мені здається?", "version": 2, "previous_id": "secret-10"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-11',2,$catalog${"id": "secret-v2-11", "category": "secret", "text": "Який подарунок свідчив би, що тебе уважно слухали?", "version": 2, "previous_id": "secret-11"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-12',2,$catalog${"id": "secret-v2-12", "category": "secret", "text": "Коли ти востаннє подумав(-ла): «От би ми з тобою теж так спробували»?", "version": 2, "previous_id": "secret-12"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-13',2,$catalog${"id": "secret-v2-13", "category": "secret", "text": "Яке місце ти хотів(-ла) б показати мені тільки тому, що воно твоє?", "version": 2, "previous_id": "secret-13"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-14',2,$catalog${"id": "secret-v2-14", "category": "secret", "text": "На яку спонтанну пригоду ти легше наважився(-лася) б разом зі мною?", "version": 2, "previous_id": "secret-14"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-15',2,$catalog${"id": "secret-v2-15", "category": "secret", "text": "Що ти створив(-ла) б, якби не боявся(-лася) недосконалості?", "version": 2, "previous_id": "secret-15"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-16',2,$catalog${"id": "secret-v2-16", "category": "secret", "text": "Яка твоя улюблена мрія зовсім не потребує великих грошей?", "version": 2, "previous_id": "secret-16"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-17',2,$catalog${"id": "secret-v2-17", "category": "secret", "text": "Чи є свято, яке ти потай хотів(-ла) б відзначити зовсім інакше, ніж заведено?", "version": 2, "previous_id": "secret-17"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-18',2,$catalog${"id": "secret-v2-18", "category": "secret", "text": "Яку нову роль у житті тобі цікаво було б приміряти, якби ніхто не здивувався?", "version": 2, "previous_id": "secret-18"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-19',2,$catalog${"id": "secret-v2-19", "category": "secret", "text": "Яка розкіш для тебе — не про гроші?", "version": 2, "previous_id": "secret-19"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-20',2,$catalog${"id": "secret-v2-20", "category": "secret", "text": "Який комплімент про твій характер рідко звучить, але важливий?", "version": 2, "previous_id": "secret-20"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-21',2,$catalog${"id": "secret-v2-21", "category": "secret", "text": "Що ти хотів(-ла) б, щоб я пам’ятав(-ла) про тебе навіть через багато років?", "version": 2, "previous_id": "secret-21"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-22',2,$catalog${"id": "secret-v2-22", "category": "secret", "text": "Який дивний або кумедний задум ти досі тримаєш у нотатках?", "version": 2, "previous_id": "secret-22"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-23',2,$catalog${"id": "secret-v2-23", "category": "secret", "text": "Який твій талант заслуговує більше місця в житті?", "version": 2, "previous_id": "secret-23"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-24',2,$catalog${"id": "secret-v2-24", "category": "secret", "text": "Який наш звичайний день із майбутнього ти іноді уявляєш перед сном?", "version": 2, "previous_id": "secret-24"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-25',2,$catalog${"id": "secret-v2-25", "category": "secret", "text": "Що ти хотів(-ла) б одного разу зробити тільки для нас, без фото й гостей?", "version": 2, "previous_id": "secret-25"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-26',2,$catalog${"id": "secret-v2-26", "category": "secret", "text": "Яка несподівана думка про мене нещодавно змусила тебе усміхнутися?", "version": 2, "previous_id": "secret-26"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-27',2,$catalog${"id": "secret-v2-27", "category": "secret", "text": "Якби на місяць можна було прибрати одну турботу, чому ти присвятив(-ла) б звільнений час?", "version": 2, "previous_id": "secret-27"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-28',2,$catalog${"id": "secret-v2-28", "category": "secret", "text": "Яку свою зміну за останній рік ти хотів(-ла) б відсвяткувати?", "version": 2, "previous_id": "secret-28"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-29',2,$catalog${"id": "secret-v2-29", "category": "secret", "text": "Яке побажання собі ти досі соромишся сказати вголос?", "version": 2, "previous_id": "secret-29"}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-v2-30',2,$catalog${"id": "secret-v2-30", "category": "secret", "text": "Яку невелику мрію нам було б приємно підтримати одне в одному?", "version": 2, "previous_id": "secret-30"}$catalog$::jsonb);
create or replace function public.connection_action(p_action text,p_id uuid,p_expected integer,p_payload jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified_user(); s public.connection_sessions; m public.connection_moods; v public.connection_answers;
 sp uuid; am uuid; bm uuid; b uuid; d date; j jsonb; old public.connection_requests; intent jsonb;
 result jsonb:='{}'; n integer; pos integer; item record; q jsonb; cat text;
begin
 if p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>40000 or p_expected is null then raise exception 'connection_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select space_id,id into sp,am from public.couple_members where user_id=u and left_at is null;
 if sp is not null then perform 1 from public.couple_spaces where id=sp for update; end if;
 select id,user_id into bm,b from public.couple_members where space_id=sp and user_id<>u and left_at is null;
 intent:=to_jsonb(encode(sha256(convert_to(jsonb_build_object('action',p_action,'id',p_id,'expected',p_expected,'payload',p_payload)::text,'UTF8')),'hex'));
 select * into old from public.connection_requests where user_id=u and request_id=p_request;
 if found then
   if old.intent<>intent then raise exception 'connection_conflict'; end if;
   if old.result ? 'id' and not public.connection_access((old.result->>'id')::uuid) then return '{}'::jsonb; end if;
   return old.result; -- only own current-epoch receipt; no stale session identifier
 end if;
 d:=(public.connection_clock() at time zone 'UTC')::date;
 if p_action='mood' then
   if p_payload->>'day' is distinct from to_char(d,'YYYY-MM-DD') then raise exception 'connection_period_changed'; end if;
   select * into m from public.connection_moods where user_id=u and day=d for update;
   if coalesce(m.version,0)<>p_expected then raise exception 'connection_changed'; end if;
   if p_payload->>'mood' not in ('wonderful','good','calm','tired','anxious','sad','irritated','uncertain')
    or coalesce((p_payload->>'intensity')::integer,0) not between 1 and 5 or char_length(coalesce(p_payload->>'note',''))>500
    or jsonb_typeof(p_payload->'shared') is distinct from 'boolean' or jsonb_typeof(p_payload->'support') is distinct from 'boolean' then raise exception 'connection_invalid'; end if;
   insert into public.connection_moods values(u,d,p_payload->>'mood',(p_payload->>'intensity')::integer,coalesce(p_payload->>'note',''),(p_payload->>'support')::boolean,(p_payload->>'shared')::boolean,am,bm,1)
   on conflict(user_id,day) do update set mood=excluded.mood,intensity=excluded.intensity,note=excluded.note,support=excluded.support,shared=excluded.shared,member_id=excluded.member_id,partner_member_id=excluded.partner_member_id,version=connection_moods.version+1;
   delete from public.connection_reactions where owner_id=u and day=d; -- old support never implies a response to edited content
 elsif p_action='react' then
   if b is null or not public.connection_mood_access(b,(p_payload->>'day')::date) then raise exception 'connection_unavailable'; end if;
   insert into public.connection_reactions values(b,(p_payload->>'day')::date,u,p_payload->>'reaction') on conflict(owner_id,day,user_id) do update set reaction=excluded.reaction;
 elsif p_action in ('start_game','start_questionnaire') then
   if b is null then raise exception 'connection_partner_required'; end if;
   cat:=case when p_action='start_game' then 'game' else 'questionnaire' end;
   select count(*) into n from public.connection_sessions where a=u and kind=cat;
   if n<>p_expected then raise exception 'connection_changed'; end if;
   if cat='questionnaire' and not exists(select 1 from public.connection_catalog where kind='questionnaire' and id=p_payload->>'catalog') then raise exception 'connection_invalid'; end if;
   if (select count(*) from public.connection_sessions where space_id=sp and status in ('pending','active','paused'))>=30 then raise exception 'connection_limit'; end if;
   insert into public.connection_sessions(space_id,a,b,am,bm,kind,catalog_id) values(sp,u,b,am,bm,cat,p_payload->>'catalog') returning * into s;
   result:=jsonb_build_object('id',s.id);
 elsif p_action='delete_own_history' then
   select * into s from public.connection_sessions where id=p_id for update;
   if not found or u not in(s.a,s.b) then raise exception 'connection_unavailable'; end if;
   delete from public.connection_answers where session_id=s.id and user_id=u;
   update public.connection_sessions set status='closed' where id=s.id;
 else
   select * into s from public.connection_sessions where id=p_id for update;
   if not found or not public.connection_access(s.id) or s.space_id is distinct from sp then raise exception 'connection_unavailable'; end if;
   if p_action='accept' then
     if s.b<>u or s.status<>'pending' then raise exception 'connection_changed'; end if;
     update public.connection_sessions set status='active' where id=s.id;
     if s.kind='game' then
       insert into public.connection_deck(session_id,position,card_id) select s.id,row_number() over(order by random()),id from public.connection_catalog where kind='card' and version=s.game_catalog_version;
     end if;
   elsif p_action in ('decline','close','pause','resume') then
     if p_action='decline' and (s.b<>u or s.status<>'pending') then raise exception 'connection_changed'; end if;
     if (p_action='pause' and s.status<>'active') or (p_action='resume' and s.status<>'paused') or (s.status not in ('pending','active','paused') and not(p_action='close' and s.status='completed')) then raise exception 'connection_changed'; end if;
     update public.connection_sessions set status=case p_action when 'decline' then 'declined' when 'close' then 'closed' when 'pause' then 'paused' else 'active' end where id=s.id;
     if p_action='close' and s.kind='questionnaire' then delete from public.connection_answers where session_id=s.id and user_id=u; end if;
   elsif p_action='erase_answers' then
     delete from public.connection_answers where session_id=s.id and user_id=u;
     update public.connection_sessions set status='closed' where id=s.id;
   elsif p_action='opt' and s.kind='game' then
     if (s.status not in ('active','paused') and p_payload->'enabled' is distinct from 'false'::jsonb) or jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' then raise exception 'connection_invalid'; end if;
     update public.connection_sessions cs set opt_a=case when cs.a=u then (p_payload->>'enabled')::boolean else opt_a end,opt_b=case when cs.b=u then (p_payload->>'enabled')::boolean else opt_b end where id=s.id;
     -- Withdrawing category consent also permanently withdraws own old publications.
     -- Re-enabling categories authorizes future cards, never resurrects old reports.
     if p_payload->'enabled'='false'::jsonb then
       update public.connection_answers a set published=false where a.session_id=s.id and a.user_id=u
       and exists(select 1 from public.connection_draws d join public.connection_catalog c on c.kind='card' and c.id=d.card_id
         where d.session_id=s.id and d.slot=a.slot and c.content->>'category' in ('heat','secret'));
     end if;
   elsif p_action='draw' and s.kind='game' then
     if s.status<>'active' or s.position<>p_expected then raise exception 'connection_changed'; end if;
     if s.position>0 and (select count(*) from public.connection_answers where session_id=s.id and slot=s.position and submitted)<>2 then raise exception 'connection_not_ready'; end if;
     select dk.position into pos from public.connection_deck dk join public.connection_catalog c on c.kind='card' and c.id=dk.card_id
      where dk.session_id=s.id and not dk.drawn and (s.opt_a and s.opt_b or c.content->>'category' not in ('heat','secret')) order by dk.position limit 1;
     if pos is null then
       if exists(select 1 from public.connection_deck where session_id=s.id and not drawn) then raise exception 'connection_categories_locked'; end if;
       update public.connection_sessions set status='completed' where id=s.id;
     else
       update public.connection_deck set drawn=true where session_id=s.id and position=pos;
       -- position in sessions is the DRAW NUMBER; deck position is private shuffle order.
       update public.connection_sessions set position=position+1 where id=s.id;
       insert into public.connection_draws(session_id,slot,card_id) select s.id,s.position+1,card_id from public.connection_deck where session_id=s.id and position=pos;
     end if;
   elsif p_action in ('save','submit','skip','unpublish') then
     if p_action='skip' and s.kind<>'game' then raise exception 'connection_invalid'; end if;
     if s.status<>'active' and p_action<>'unpublish' then raise exception 'connection_changed'; end if;
     pos:=case when s.kind='game' then s.position else 0 end;
     if p_payload->>'slot' is distinct from pos::text or (s.kind='game' and pos=0) then raise exception 'connection_changed'; end if;
     select * into v from public.connection_answers where session_id=s.id and user_id=u and slot=pos;
     if coalesce(v.version,0)<>p_expected then raise exception 'connection_changed'; end if;
     if v.submitted and p_action not in ('unpublish') then raise exception 'connection_changed'; end if;
     j:=case when p_action='skip' then to_jsonb(''::text) else coalesce(p_payload->'answers',v.draft,'{}') end;
     if s.kind='game' then
       if jsonb_typeof(j)<>'string' or char_length(j#>>'{}')>2000 then raise exception 'connection_invalid'; end if;
     else
       if jsonb_typeof(j)<>'object' then raise exception 'connection_invalid'; end if;
       select content into q from public.connection_catalog where kind='questionnaire' and id=s.catalog_id;
       if exists(select 1 from jsonb_object_keys(j) k where not exists(select 1 from jsonb_array_elements(q->'questions') x where x->>'id'=k)) then raise exception 'connection_invalid'; end if;
       for item in select value as x from jsonb_array_elements(q->'questions') loop
         if j ? (item.x->>'id') then
           if item.x->>'type'='scale' then
             if coalesce(j->>(item.x->>'id'),'') not in ('1','2','3','4','5') then raise exception 'connection_invalid'; end if;
           elsif not exists(select 1 from jsonb_array_elements(item.x->'options') o where o->>'id'=j->>(item.x->>'id')) then raise exception 'connection_invalid'; end if;
         elsif p_action='submit' then raise exception 'connection_not_ready'; end if;
       end loop;
     end if;
     if p_action='submit' and p_payload->'publish' is distinct from 'true'::jsonb then raise exception 'connection_consent_required'; end if;
     if p_action='unpublish' then
       delete from public.connection_answers where session_id=s.id and user_id=u and slot=pos;
       update public.connection_sessions set status='closed' where id=s.id;
     else
       insert into public.connection_answers(session_id,user_id,slot,draft,submitted,published,skipped,version)
       values(s.id,u,pos,case when p_action='skip' then to_jsonb(''::text) else j end,p_action in ('submit','skip'),p_action in ('submit','skip'),p_action='skip',1)
       on conflict(session_id,user_id,slot) do update set draft=excluded.draft,submitted=excluded.submitted,published=excluded.published,skipped=excluded.skipped,version=connection_answers.version+1;
       if s.kind='questionnaire' and (select count(*) from public.connection_answers where session_id=s.id and submitted and published)=2 then update public.connection_sessions set status='completed' where id=s.id; end if;
     end if;
   elsif p_action='notify' and s.kind='game' and s.position>0 and s.status in ('active','paused') then
     if s.position<>p_expected then raise exception 'connection_changed'; end if;
     insert into public.connection_events values(s.id,s.position,u,case when s.a=u then s.b else s.a end,false) on conflict do nothing;
   elsif p_action='ack' then
     update public.connection_events set acknowledged=true where session_id=s.id and recipient=u and position=p_expected;
   else raise exception 'connection_invalid'; end if;
 end if;
 insert into public.connection_requests values(u,p_request,intent,result);
 return result;
exception when invalid_text_representation or check_violation or not_null_violation or unique_violation then raise exception 'connection_invalid';
end $$;

revoke all on function public.connection_action(text,uuid,integer,jsonb,uuid) from public,anon;
grant execute on function public.connection_action(text,uuid,integer,jsonb,uuid) to authenticated;
commit;
