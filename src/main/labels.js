'use strict';

// The tray menu (and the one she opens when you right-click her), in every language she speaks.
// The order of this object is the order of the Language submenu.

const TRAY = {
  fr: {
    name: 'Français',
    online: (port) => `Capri — à l'écoute sur ${port}`,
    teleport: 'Téléporter', satellite: 'Regarder le satellite', demo: 'Lancer la démo', help: 'Comment ça marche ?',
    show: 'La faire revenir', hide: 'La ranger',
    size: 'Taille', small: 'Petite', medium: 'Moyenne', large: 'Grande', sound: 'Son', mute: 'Muet',
    soundsDir: 'Ouvrir le dossier des sons perso', screen: 'Écran', wander: 'Se balader quand rien ne se passe',
    possess: 'Posséder mes fenêtres', lang: 'Langue', auto: 'Automatique (système)', startup: 'Lancer au démarrage',
    hooksOn: 'Hooks Codex : installés', hooksOff: 'Installer les hooks Codex',
    hooksRemove: 'Retirer les hooks Codex', quit: 'Quitter',
  },
  en: {
    name: 'English',
    online: (port) => `Capri — listening on ${port}`,
    teleport: 'Teleport', satellite: 'Look at the satellite', demo: 'Play demo', help: 'How does it work?',
    show: 'Bring her back', hide: 'Put her away',
    size: 'Size', small: 'Small', medium: 'Medium', large: 'Large', sound: 'Sound', mute: 'Mute',
    soundsDir: 'Open custom sounds folder', screen: 'Screen', wander: 'Wander around when idle',
    possess: 'Possess my windows', lang: 'Language', auto: 'Automatic (system)', startup: 'Start with Windows',
    hooksOn: 'Codex hooks: installed', hooksOff: 'Install Codex hooks',
    hooksRemove: 'Remove Codex hooks', quit: 'Quit',
  },
  es: {
    name: 'Español',
    online: (port) => `Capri — escuchando en ${port}`,
    teleport: 'Teletransportar', satellite: 'Mirar el satélite', demo: 'Ver la demo', help: '¿Cómo funciona?',
    show: 'Traerla de vuelta', hide: 'Guardarla',
    size: 'Tamaño', small: 'Pequeña', medium: 'Mediana', large: 'Grande', sound: 'Sonido', mute: 'Silenciar',
    soundsDir: 'Abrir la carpeta de sonidos propios', screen: 'Pantalla', wander: 'Pasear cuando no pasa nada',
    possess: 'Poseer mis ventanas', lang: 'Idioma', auto: 'Automático (sistema)', startup: 'Iniciar con Windows',
    hooksOn: 'Hooks de Codex: instalados', hooksOff: 'Instalar los hooks de Codex',
    hooksRemove: 'Quitar los hooks de Codex', quit: 'Salir',
  },
  pt: {
    name: 'Português (Brasil)',
    online: (port) => `Capri — ouvindo na porta ${port}`,
    teleport: 'Teletransportar', satellite: 'Olhar o satélite', demo: 'Ver a demo', help: 'Como funciona?',
    show: 'Trazer de volta', hide: 'Guardar',
    size: 'Tamanho', small: 'Pequena', medium: 'Média', large: 'Grande', sound: 'Som', mute: 'Sem som',
    soundsDir: 'Abrir a pasta de sons personalizados', screen: 'Tela', wander: 'Passear quando nada acontece',
    possess: 'Possuir minhas janelas', lang: 'Idioma', auto: 'Automático (sistema)', startup: 'Iniciar com o Windows',
    hooksOn: 'Hooks do Codex: instalados', hooksOff: 'Instalar os hooks do Codex',
    hooksRemove: 'Remover os hooks do Codex', quit: 'Sair',
  },
  ru: {
    name: 'Русский',
    online: (port) => `Capri — слушаю порт ${port}`,
    teleport: 'Телепортироваться', satellite: 'Посмотреть на спутник', demo: 'Запустить демо', help: 'Как это работает?',
    show: 'Вернуть её', hide: 'Спрятать',
    size: 'Размер', small: 'Маленькая', medium: 'Средняя', large: 'Большая', sound: 'Звук', mute: 'Без звука',
    soundsDir: 'Открыть папку своих звуков', screen: 'Экран', wander: 'Гулять, когда ничего не происходит',
    possess: 'Вселяться в мои окна', lang: 'Язык', auto: 'Автоматически (системный)', startup: 'Запускать вместе с Windows',
    hooksOn: 'Хуки Codex: установлены', hooksOff: 'Установить хуки Codex',
    hooksRemove: 'Удалить хуки Codex', quit: 'Выйти',
  },
};

module.exports = { TRAY, LANGS: Object.keys(TRAY) };
