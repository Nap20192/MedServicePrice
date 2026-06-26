-- Bootstrap the source registry with the TЗ target sites. config is left minimal;
-- the team fills start urls / selectors per source during development.
INSERT INTO sources (code, name, base_url, parser_kind) VALUES
    ('kdl',     'KDL / KDL Olymp',        'https://kdl.kz',          'html'),
    ('invitro', 'Инвитро',                 'https://invitro.kz',      'html'),
    ('helix',   'Хеликс',                  'https://helix.kz',        'html'),
    ('olymp',   'Медцентр Олимп',          'https://olymp.kz',        'html'),
    ('doq',     'doq.kz (агрегатор клиник)','https://doq.kz',          'api'),
    ('medel',   'МЕДЭЛ',                   'https://medel.kz',        'html'),
    ('mck',     'МЦК',                     'https://mck.kz',          'html'),
    ('aksai',   'Аксай (региональные)',    'https://aksai-clinic.kz', 'html')
ON CONFLICT (code) DO NOTHING;
