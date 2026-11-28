# What's new

Each version is a `vX.Y.Z` tag and a GitHub Release with the same text: the bot shows it in the new-version notice, in its own language (from 0.5.3 English first, then Russian under `### Русский`).

## 0.19.3

- **A bigger team by a button.** `/team` now has buttons for how many agents the topic's head may have at once: 5, 10, 15 or 20. When the head runs into the limit, it tells you where to raise it.

### Русский

- **Команда побольше по кнопке.** В `/team` появились кнопки: сколько агентов может быть у хеда этого топика одновременно, 5, 10, 15 или 20. Упёршись в предел, хед скажет, где его поднять.

## 0.19.2

- **“Stop asking” works for files in a group.** A file bound for a group that others read is asked about in every mode, and the two buttons under that question, “until the task ends” and “stop asking in this topic”, did nothing for the next file: each one asked again. They now hold as they say, when tapped under a question about a file.

### Русский

- **«Больше не спрашивать» работает для файлов в группе.** Про файл для группы, которую читают другие, бот спрашивает в любом режиме, и две кнопки под этим вопросом, «до конца задачи» и «больше не спрашивать тут», на следующий файл не действовали: вопрос приходил снова. Теперь они действуют, как написано, если нажаты под вопросом о файле.

## 0.19.1

- **Mentioned with nothing asked, a companion joins the conversation.** A bare `@claude` used to get “what do you need?”. Now the conversation above is the request: it reads what was just discussed and what the message replies to, and answers that.
- **A companion looks at albums and can follow pictures.** A reply to one picture of an album shows it the whole album, up to six. Switched on in the card, it also looks at every picture as it comes, silently, and keeps a line about what it shows: up to 40 a day for a chat.
- **A companion sees what you reply to in a supergroup.** A reply to a picture, a voice message or a table was taken for no reply at all when it answered the first message of its thread, which is most replies: the picture was not looked at, and a bare `@claude` got “what do you need?”. Tables and other formatted messages are now read as their text. The same mistake dropped the replied message from Claude's view in a workspace without topics.
- **A team's board is no longer sent over and over when Telegram stumbles.** When an edit of the board failed for any reason, the bot sent a new board. On the night of 26.11 Telegram refused edits for an hour and then answered slowly: every head's topic got some thirty copies of its board within minutes. A new board is now sent only when the old one is gone; otherwise the bot waits and tries the edit again.
- **An answer is no longer lost to an emoji in a command.** The list of steps under an answer shortens each command to 70 characters; with an emoji at the cut, half of it was left, and Telegram refused the whole answer: three tries, then “turn failed” and nothing in the chat. Text is now cut between characters, and everything leaving for Telegram is checked once more.
- **The buttons of a companion's card fit a phone.** “Switch the web off” and its like were cut in the middle of a word. A switch is now named by what it switches, with a tick while it is on.

### Русский

- **Если собеседника отметили, ничего не спросив, он включается в разговор.** На голый `@claude` он раньше отвечал «что нужно?». Теперь запрос — это сам разговор: он читает, что только что обсуждали и на что ответили, и отвечает по делу.
- **Собеседник смотрит альбомы и может следить за картинками.** Ответ на одну картинку из альбома показывает ему весь альбом, до шести штук. Если включить в карточке, он смотрит каждую картинку сразу и молча и хранит строчку о том, что на ней: до 40 в день на чат.
- **Собеседник видит, на что ему ответили в супергруппе.** Ответ на картинку, голосовое или таблицу не считался ответом, если он шёл на первое сообщение своей ветки, а это большинство ответов: картинку бот не смотрел, а на голый `@claude` спрашивал «что нужно?». Таблицы и другие оформленные сообщения теперь читаются как текст. Та же ошибка прятала от Claude сообщение, на которое ответили, в воркспейсе без топиков.
- **Доска команды больше не присылается снова и снова, когда у Telegram сбой.** Если правка доски не проходила по любой причине, бот отправлял новую доску. В ночь на 26.11 Telegram час отклонял правки, а потом отвечал медленно: в топике каждого хеда за несколько минут появилось около тридцати копий доски. Теперь новая доска отправляется, только если старой больше нет; иначе бот ждёт и пробует править снова.
- **Ответ больше не теряется из-за эмодзи в команде.** В списке шагов под ответом каждая команда обрезается до 70 символов; если на месте обрезки стоял эмодзи, от него оставалась половина, и Telegram отказывался принять весь ответ: три попытки, потом «turn failed» и пустота в чате. Теперь текст режется между символами, а всё, что уходит в Telegram, проверяется ещё раз.
- **Кнопки в карточке собеседника помещаются на телефоне.** «Выключить интернет» и подобные обрезались посреди слова. Переключатель теперь называется тем, что он переключает, с галочкой, пока включён.

## 0.19.0

- **A companion for a group chat.** Added to a group, the bot now asks what it is there for: a workspace, or a companion that answers everyone in the chat who addresses it with `@bot`, `@claude` or a reply. A companion only talks: no computer, file, command or setting exists in such a chat, for you either. It searches the web and reads links, shows pictures from Wikimedia Commons, sets reminders, hears a voice message or sees a picture that someone replies to, and remembers the last 300 messages plus a notebook of what came before.
- **Asked by several at once, a companion answers each message by itself.** In the order they came, each with all that was said before it, its own answers too. A message that waits is marked 👀; nothing moves one up the line. While it works the chat sees one plain line at most, such as “Searching the web…”, never its steps.
- **A companion is yours to switch on and to limit.** Only you can make a group a companion, and it stays silent until you switch it on. Its card is in your private chat, under `/workspace`: the model (Haiku, Sonnet or Opus), the account, answers a day for the whole chat, web search, pause, erase memory, leave. If you leave the chat or are removed from it, the bot leaves too and deletes what it kept.
- **A companion gives nothing away about the server or the account.** Its instructions forbid it, and every answer is also checked before it is sent for the account's address, the system's version and the server's folders: one that carries any is held back, and you are told who asked. Files from the chat are never opened. A page is read only at a public address, and a site it reads does see the server's address.
- **A word of advice in the morning.** Switched on in a companion's card, it gives one person of the chat a piece of advice nobody asked for, in the manner of an old sage, about what they wrote yesterday. Never the same person two mornings running; with nobody who said enough, or no answers left, it says nothing.
- **A companion can follow voice messages.** Switched on in its card, it hears voice messages of up to two minutes as they come, silently, so that their words are part of what it knows: half an hour of speech a day for a chat, one at a time, and never ahead of a voice message of your own.
- **Someone who hammers a companion is no longer answered.** More than 8 requests in two minutes or 30 in an hour, and the bot tells them once and stops answering them. You get a message with what they wrote and a button to unblock; the card keeps the list.
- **The list of heavy commands is free of one-offs.** A command is shown once it has been heavy twice, and counts as the same command whatever its output is piped into or wherever it was started from: `npm test 2>&1 | grep …` is `npm test`.
- **Voice messages are heard as fast with the cloud busy.** Speech is transcribed on the server's own processors, and a cloud given four of six of them slowed it by a third. The bot's share against the cloud's is now 64 to 1: the cloud's work stands still for the seconds a voice message takes. The server's log says how long each one took.

### Русский

- **Собеседник для группового чата.** Когда бота добавляют в группу, он теперь спрашивает, зачем он здесь: воркспейс или собеседник, который отвечает всем в чате, кто обратился к нему через `@бот`, `@claude` или ответом на его сообщение. Собеседник только разговаривает: компьютеров, файлов, команд и настроек в таком чате нет ни для кого, и для тебя тоже. Он ищет в интернете и читает ссылки, показывает картинки с Wikimedia Commons, ставит напоминания, слушает голосовое и смотрит картинку, на которые ему ответили, и помнит последние 300 сообщений и заметки о том, что было раньше.
- **Когда к собеседнику обращаются сразу несколько человек, он отвечает на каждое сообщение отдельно.** По очереди, как пришли, и каждый раз видит всё, что было сказано до этого, включая свои ответы. Сообщение, которое ждёт, помечается 👀; вперёд очереди ничего не проходит. Пока он работает, чат видит максимум одну простую строку вроде «Ищу в интернете…», но не его шаги.
- **Собеседника включаешь и ограничиваешь только ты.** Сделать группу собеседником можешь только ты, и он молчит, пока ты его не включишь. Его карточка лежит в личном чате, в `/workspace`: модель (Haiku, Sonnet или Opus), аккаунт, число ответов в день на весь чат, поиск в интернете, пауза, стереть память, уйти. Если ты вышел из чата или тебя из него убрали, бот тоже выходит и удаляет всё, что хранил.
- **Собеседник ничего не выдаёт о сервере и аккаунте.** Это запрещено его инструкциями, а каждый ответ перед отправкой ещё и проверяется на почту аккаунта, версию системы и папки сервера: ответ, где что-то из этого есть, не уходит, а тебе приходит сообщение, кто спрашивал. Файлы из чата он не открывает. Страницу читает только по публичному адресу, и сайт, который он читает, видит адрес сервера.
- **Совет по утрам.** Включается в карточке собеседника: раз в утро один участник чата получает непрошеный совет в духе древнего мудреца о том, что он писал вчера. Два утра подряд одному и тому же не достаётся; если никто не сказал достаточно или ответы на сегодня кончились, бот молчит.
- **Собеседник может следить за голосовыми.** Включается в карточке: голосовые до двух минут он слушает сразу и молча, и их слова становятся частью того, что он знает. Полчаса речи в день на чат, по одному за раз и никогда вперёд твоего собственного голосового.
- **Тому, кто заваливает собеседника запросами, он перестаёт отвечать.** Больше 8 запросов за две минуты или 30 за час, и бот один раз говорит об этом и замолкает для этого человека. Тебе приходит сообщение с тем, что он писал, и кнопкой «Разблокировать»; список хранится в карточке.
- **В списке тяжёлых команд нет разовых.** Команда показывается, когда оказалась тяжёлой дважды, и считается той же самой, куда бы ни шёл её вывод и откуда бы её ни запускали: `npm test 2>&1 | grep …` это `npm test`.
- **Голосовые расшифровываются так же быстро при занятом облаке.** Речь расшифровывается на процессорах самого сервера, и облако, которому выдали четыре из шести, замедляло её на треть. Доля бота против облака теперь 64 к 1: работа облака замирает на те секунды, что занимает голосовое. В журнале сервера видно, сколько заняло каждое.

## 0.18.11

- **Changes to Claude's instructions reach a conversation under way.** A conversation keeps the instructions it began with: a night shift, a topic set to read-only, a browser switched on, new decisions of a workspace, a new skill or an edited CLAUDE.md were never seen by a conversation already going, until it was compacted or started anew. The bot now keeps count of what each conversation was told and says a change in Claude's next turn, once. A conversation that began before this release is told what is in force the first time it goes on.

### Русский

- **Изменения инструкций Claude доходят до идущего разговора.** Разговор живёт с теми инструкциями, с которыми начался: ночную смену, режим «только чтение», включённый браузер, новые решения рабочей группы, новый скилл или правку CLAUDE.md уже идущий разговор не видел, пока его не сжимали или не начинали заново. Теперь бот ведёт учёт того, что сказано каждому разговору, и сообщает об изменении в следующем ходе Claude, один раз. Разговор, начатый до этого выпуска, получает действующее при первом же продолжении.

## 0.18.10

- **The computers reach a head already at work.** What each computer has and how busy it is was written into Claude's instructions, and a conversation that goes on keeps the instructions it began with: a head in the middle of its work never saw them. They are now the answer of a tool, `where_to_run`, read at the moment it is asked, with the rule for moving heavy work in the tool's own description. An agent is told only what its computer has, which doesn't change.

### Русский

- **Данные о компьютерах доходят до хеда, который уже работает.** Что есть у каждого компьютера и насколько он занят, писалось в инструкции Claude, а продолжающийся разговор живёт с теми инструкциями, с которыми начался: хед посреди работы их не видел. Теперь это ответ инструмента `where_to_run`, который читает данные в момент вопроса, а правило о переносе тяжёлой работы стоит в описании самого инструмента. Агенту сообщается только то, что есть у его компьютера и не меняется.

## 0.18.9

- **Claude always sees the computers.** What each computer has and how busy it is was shown only when this one was 70% busy or a heavy command was on record: asked where work is cheaper, Claude had nothing to answer with. Now the line is always there when more than one computer is online, and the advice to move heavy work starts at half busy.
- **An agent knows its own computer.** An agent in the cloud measured it with the system's tools and reported the whole server, 6 processors and 11 GB, for a container given 4 and 6. Each agent is now told what its computer has and how busy it is.
- **Where the work runs is on the team's board.** An agent on another computer than its head is marked with it, the cloud included, and the board's last line says how busy the team's computers are. /devices shows for each computer online its processors, memory and load.

### Русский

- **Claude всегда видит компьютеры.** Что есть у каждого компьютера и насколько он занят, показывалось, только когда этот был занят на 70% или была измерена тяжёлая команда: на вопрос, где работа выгоднее, Claude было нечем ответить. Теперь строка есть всегда, когда в сети больше одного компьютера, а совет переносить тяжёлое начинается с половины загрузки.
- **Агент знает свой компьютер.** Агент в облаке мерил его системными командами и доложил про весь сервер, 6 процессоров и 11 ГБ, хотя контейнеру выдано 4 и 6. Теперь каждому агенту сказано, что есть у его компьютера и насколько он занят.
- **На доске команды видно, где идёт работа.** Агент на другом компьютере, чем его хед, помечен этим компьютером, облако тоже, а в последней строке доски стоит загрузка компьютеров команды. /devices показывает для каждого компьютера в сети процессоры, память и загрузку.

## 0.18.8

- **Claude knows where heavy work is cheaper.** Each computer says what it has (processors, memory), how busy it is and whether someone is working at it. When this computer is busy or a project has heavy commands on record, Claude sees all computers side by side and is told to send long work nobody waits for where there is room.
- **Heavy commands are measured.** A command that took much processor time is remembered with what it cost; before it runs again Claude sees how long it took here and about how long it would take on each other computer. The figures are rough: they tell minutes from hours.
- **A branch on another computer in one step.** `sync_branch` pushes the project's branch, clones the project on the other computer if it isn't there (light, without the folders `.worktree-skip` names) or brings its clone up to date, with submodules. Then an agent runs the work there. Uncommitted changes don't travel, and a copy with uncommitted work of its own is left alone.
- **The bot comes before the cloud's work.** With the server's processors or memory all taken, the cloud's work waits or is the first to go, never the bot. A server whose disk is nearly full says so once a day, and the cloud takes no new projects until there is room.

### Русский

- **Claude знает, где тяжёлую работу выгоднее делать.** Каждый компьютер сообщает, что у него есть (процессоры, память), насколько он занят и работает ли за ним человек. Когда этот компьютер занят или у проекта есть измеренные тяжёлые команды, Claude видит все компьютеры рядом и знает правило: долгую работу, которой никто не ждёт, отправлять туда, где свободно.
- **Тяжёлые команды измеряются.** Команда, съевшая много процессорного времени, запоминается вместе с ценой; перед новым запуском Claude видит, сколько она шла здесь и примерно сколько займёт на каждом другом компьютере. Цифры грубые: отличают минуты от часов.
- **Ветка на другом компьютере за один шаг.** `sync_branch` пушит ветку проекта, клонирует проект на другом компьютере, если его там нет (легко, без папок из `.worktree-skip`), или подтягивает его копию, вместе с подмодулями. После этого агент запускает работу там. Незакоммиченное не переезжает, а копию с чужой незакоммиченной работой бот не трогает.
- **Бот важнее работы в облаке.** Когда процессоры или память сервера заняты целиком, ждёт или первой завершается работа облака, а не бот. Сервер с почти полным диском говорит об этом раз в сутки, и облако не принимает новые проекты, пока место не появится.

## 0.18.7

- **Another computer's Chrome, worked in directly.** A topic that moved to another account at a spent limit reached the Chrome of the computer on that account only through errands: a new short session for every request, retelling what it saw. Now that Chrome is in the topic's own session, step by step, like its own; the answer says which computer's Chrome did the work.
- **A spare Chrome is found even if its computer blinked.** The computers whose Chrome could take browser work were listed once, as a task began: a laptop whose link dropped for those few seconds was left out of the whole task. Now they are looked at when Chrome is needed, and one that dropped a moment ago is waited for, up to half a minute.
- **A Chrome that wasn't used is named.** When no Chrome could do the work, the answer says for each computer why: its account is at the limit, it is offline and since when, it is locked.
- **A Mac with its lid closed sleeps, and is offline.** Under a closed lid a Mac wakes for seconds, over and over, and the agent ran in each wake: it showed online and offline by turns, and held the Mac up for five minutes after a longer sleep. Now the agent tells such a wake from a real one, leaves the link and asks nothing of the system until the Mac is opened. A dark screen during a night's work is not a sleep.
- **A napping laptop keeps its link.** A Mac on battery sleeps in short stretches, some a second longer than the server's ping, and was cut off for each: 266 times in one day. One ping without an answer is forgiven now; two in a row still end the link, within 45 seconds.
- **The server's log says why a computer went offline.** It didn't answer the pings, or it closed the link itself, and how long the link had held.

### Русский

- **Chrome другого компьютера, напрямую.** Топик, который при исчерпанном лимите перешёл на другой аккаунт, доставал Chrome компьютера с этим аккаунтом только через поручения: на каждый запрос новая короткая сессия и пересказ увиденного. Теперь этот Chrome подключён к самой сессии топика, шаг за шагом, как свой; в ответе сказано, чей Chrome делал работу.
- **Запасной Chrome находится, даже если его компьютер моргнул.** Компьютеры, чей Chrome может взять работу в браузере, перечислялись один раз, в начале задачи: ноутбук, у которого связь пропала на эти несколько секунд, выпадал на всю задачу. Теперь на них смотрят в момент, когда нужен Chrome, а того, кто отвалился только что, ждут до полуминуты.
- **Chrome, которым не воспользовались, назван.** Когда работу в браузере не смог взять никто, в ответе по каждому компьютеру сказано почему: лимит аккаунта, не в сети и с какого времени, заблокирован.
- **Mac с закрытой крышкой спит и не в сети.** Под закрытой крышкой Mac раз за разом просыпается на секунды, и агент работал в каждом таком пробуждении: компьютер мелькал «в сети / не в сети», а после сна подольше агент ещё пять минут не давал ему уснуть. Теперь агент отличает такое пробуждение от настоящего, уходит со связи и ничего не просит у системы, пока Mac не откроют. Погашенный экран во время ночной работы сном не считается.
- **Дремлющий ноутбук не теряет связь.** Mac на батарее спит короткими отрезками, иногда на секунду дольше пинга сервера, и за каждый такой отрезок получал обрыв: 266 раз за день. Один пинг без ответа теперь прощается; два подряд по-прежнему рвут связь, не позже чем через 45 секунд.
- **Журнал сервера пишет, почему компьютер пропал из сети.** Не ответил на пинги или сам закрыл связь, и сколько она продержалась.

## 0.18.6

- **Stale worktrees are offered for removal.** Agents' worktrees pile up, a few gigabytes each. Those nobody has touched for a week, with nothing uncommitted and no topic working in them, now come on a card that says how much room they take. A tap removes the folders; the branches stay, and `git worktree add` brings any of them back. "Not now" holds for a week.
- **Light worktrees.** A repository can list its heavy folders in a `.worktree-skip` file in its root, one per line (`docs/playtest`). Worktrees for agents are then made without them, and Claude makes its own the same way. An agent is told what its copy lacks and how to get a folder when the work needs it.

### Русский

- **Залежавшиеся рабочие копии предлагаются к удалению.** Копии агентов копятся, по нескольку гигабайт каждая. Те, которые не трогали неделю, где нет незакоммиченного и не работает ни один топик, теперь приходят карточкой с тем, сколько места они занимают. По нажатию удаляются папки; ветки остаются, и `git worktree add` вернёт любую. «Не сейчас» действует неделю.
- **Лёгкие рабочие копии.** Репозиторий может перечислить свои тяжёлые папки в файле `.worktree-skip` в корне, по одной на строку (`docs/playtest`). Копии для агентов создаются без них, и Claude делает свои так же. Агенту сказано, чего в его копии нет и как получить папку, когда она нужна для работы.

## 0.18.5

- **A computer's key never travels in the open.** The agent no longer connects or pairs over a plain `ws://` address, except to a server on the same computer: its key would be readable on the way. Computers connected with the line from /pair already use `wss://` and notice nothing.

### Русский

- **Ключ компьютера не ходит по сети в открытую.** Агент больше не подключается и не привязывается по незашифрованному адресу `ws://`, кроме сервера на том же компьютере: ключ можно было бы прочитать по пути. Компьютеры, подключённые строкой из /pair, уже работают по `wss://` и ничего не заметят.

## 0.18.4

- **Agents' names in the head's answers are links, for sure.** The head was asked to link its agents and went on writing «floor» in quotes. Now the bot does it itself: a name in quotes, in bold, in code or after the word "agent" becomes a link to that agent's topic. A bare word stays a word.

### Русский

- **Имена агентов в ответах хеда теперь точно ссылки.** Хеда просили давать ссылки на агентов, а он продолжал писать «floor» в кавычках. Теперь это делает сам бот: имя в кавычках, жирным, в коде или после слова «агент» становится ссылкой на топик этого агента. Просто слово остаётся словом.

## 0.18.3

- **The offer to move a cloud project comes once a day.** “The computer is online. Move the project from the cloud there?” used to return every 12 hours for each topic, and after every server update. Now each computer asks once a day at most, and an update doesn't start it again.
- **A move to another profile is quiet.** A task that moved on at a spent limit left 💔 on its message and a line about a queue, and an agent's head got an empty report that could cancel the agents waiting for it. Now there is one line saying where the task goes on, and a scheduled run stays a scheduled run.
- **Browser work finds another Chrome.** A Chrome works only through the Claude account it is signed in to. When that account's limit is spent, the work now goes by itself to the Chrome of another connected computer whose account has room, and the answer says where it was done; that Chrome's own sign-ins to sites may differ. A topic working in Chrome moves to another profile at a spent limit too, when there is such a Chrome. With none, Claude hears at once when the limit resets instead of starting a session that fails.
- **Sleep or off, your choice.** Turning a computer off is back, next to sleep. A night shift's card says what becomes of the computers after it: left on, sleep, or off. Ask Claude to turn a computer off or put it to sleep, and it shows a card with both; the bot does it a minute after your tap. Claude still can't do either with a command of its own.
- **Tidying by force.** Closing the open windows now has three settings: leave them, close them, or close everything by force. By force, an app that stays open asking to save is ended, and its unsaved work is lost; the bot names what it ended.

### Русский

- **Предложение перенести проект из облака приходит раз в сутки.** «Компьютер в сети. Перенести проект из облака туда?» возвращалось каждые 12 часов для каждого топика и после каждого обновления сервера. Теперь от каждого компьютера не чаще раза в сутки, и обновление его не возвращает.
- **Переход на другой профиль проходит тихо.** Задача, которая перешла на другой профиль из-за лимита, оставляла 💔 на своём сообщении и строку про очередь, а хед агента получал пустой отчёт, который мог отменить ждущих его агентов. Теперь остаётся одна строка о том, где задача продолжается, а запуск по расписанию остаётся запуском по расписанию.
- **Работа в браузере находит другой Chrome.** Chrome работает только через аккаунт Claude, в который он вошёл. Когда лимит этого аккаунта исчерпан, работа сама уходит в Chrome другого подключённого компьютера, у аккаунта которого лимит свободен, и в ответе сказано, где она сделана; входы на сайты в том Chrome могут быть другими. Топик, работающий в Chrome, при исчерпанном лимите тоже переходит на другой профиль, если такой Chrome есть. Если его нет, Claude сразу узнаёт, когда сбросится лимит, вместо запуска сессии, которая упадёт.
- **Сон или выключение, на твой выбор.** Выключение компьютера вернулось, рядом со сном. В карточке ночной смены выбирается, что будет с компьютерами после неё: оставить, усыпить или выключить. Попроси Claude выключить или усыпить компьютер, и он покажет карточку с обоими вариантами; бот выполнит через минуту после твоего нажатия. Сам Claude по-прежнему не может сделать ни то ни другое своей командой.
- **Принудительная уборка.** У закрытия открытых окон теперь три положения: не трогать, закрыть, закрыть всё принудительно. В принудительном программа, которая осталась открытой и просит сохранить, завершается, несохранённое в ней пропадает; бот называет, что он завершил.

## 0.18.2

- **The head links its agents right away.** In 0.18.1 the head learned an agent's link only from that agent's next report, so in its own answers the names stayed plain text until then. Now it knows the way to each of its agents at every turn.

### Русский

- **Хед сразу даёт ссылки на агентов.** В 0.18.1 хед узнавал ссылку на агента только из его следующего отчёта, и до тех пор имена в его ответах оставались простым текстом. Теперь он знает дорогу к каждому своему агенту на каждом ходу.

## 0.18.1

- **A spent limit no longer stops the work.** When a profile's limit runs out, the topic moves to another signed-in profile with room and goes on with the same task and conversation, by day as in a night shift, for agents too. Once the limit has reset, the topic goes back to its own profile.
- **Names lead to their topics.** Wherever the bot names an agent or another topic (a report, a spent limit, a stuck task, the team's board, /team, /now, /schedule, a message from another topic), the name is a link: one tap opens that topic. The head links its agents in its own answers too.

### Русский

- **Кончившийся лимит больше не останавливает работу.** Когда лимит профиля исчерпан, топик сам переходит на другой профиль со свободным лимитом и продолжает ту же задачу с той же перепиской: днём так же, как в ночной смене, и у агентов тоже. После сброса лимита топик возвращается на свой профиль.
- **Имена ведут в свои топики.** Везде, где бот называет агента или другой топик (отчёт, исчерпанный лимит, зависшая задача, доска команды, /team, /now, /schedule, сообщение из другого топика), имя стало ссылкой: один тап открывает этот топик. Хед тоже даёт ссылки на своих агентов в ответах.

## 0.18.0

- **The code is open.** The repository is public under the PolyForm Noncommercial license: free for personal and other noncommercial use. A server now installs without a GitHub token.
- **Windows really goes to sleep.** At the end of a night shift a Windows computer was told to sleep and stayed awake: Windows refused the request without saying so. Now it sleeps, and the bot no longer calls a computer asleep when its agent only reconnected.

### Русский

- **Код открыт.** Репозиторий стал публичным под лицензией PolyForm Noncommercial: бесплатно для личного и другого некоммерческого использования. Сервер теперь ставится без токена GitHub.
- **Windows действительно засыпает.** В конце ночной смены компьютер с Windows получал команду уснуть и не засыпал: Windows молча отклоняла запрос. Теперь он засыпает, а бот больше не считает компьютер уснувшим, если его агент просто переподключился.

## 0.17.9

- **No paid extra usage unawares.** An account with claude.ai's Extra usage on goes past its plan limit on paid usage instead of stopping. A night shift now treats that as the limit and goes on on another profile with room; by day the bot tells you once, with /stop and /profile.
- **One memory for all profiles.** What Claude remembers of you is shared between your Claude profiles, so a second account knows what the first one learned.

### Русский

- **Никакого платного Extra usage втихую.** Аккаунт с включённым на claude.ai Extra usage после лимита продолжает за деньги, а не останавливается. Ночная смена теперь считает это лимитом и переходит на другой профиль, где лимит ещё есть; днём бот один раз предупреждает, с /stop и /profile.
- **Одна память на все профили.** То, что Claude запомнил о тебе, общее для всех твоих профилей Claude, так что второй аккаунт знает то, что узнал первый.

## 0.17.8

- **Chrome through the server at night, by itself.** In a night shift nobody answers the card about how Chrome goes online, so a Mac's Chrome that went direct (after a restart) is now restarted through the server by itself, with its tabs. One that can't go through the server stays unused that night rather than show your own address, and the summary says so.

### Русский

- **Chrome через сервер ночью — сам.** В ночной смене некому ответить на карточку о том, как Chrome ходит в интернет, поэтому Chrome на Mac, который после перезапуска пошёл напрямую, теперь сам перезапускается через сервер с теми же вкладками. Тот, что не может идти через сервер, этой ночью не используется, чтобы не показывать твой адрес, и сводка об этом скажет.

## 0.17.7

- **Chrome's account remembered.** The bot now keeps which Claude profile a chosen Chrome is signed in to, so a topic on another account always reaches it through an errand, even on a computer without a profile of its own.

### Русский

- **Аккаунт Chrome запоминается.** Бот теперь хранит, в какой профиль Claude вошёл выбранный Chrome, поэтому топик на другом аккаунте всегда доходит до него через поручение, даже на компьютере без своего профиля.

## 0.17.6

- **A Claude profile for each computer.** In /devices a computer can get its own Claude profile: its topics run on it from their next message, the conversation carried over, and a topic moved to another computer follows that one. A topic that picked its own in /profile keeps it, with a button back.
- **Chrome on any computer, any account.** Asked to look in Chrome that the topic's session can't reach (on another computer, or on this one signed in to another Claude account), Claude hands the task to a short session on that Chrome's account and gets back what it found, with screenshots. Nothing to switch.
- **Night shifts and Chrome.** A night shift no longer moves a topic working in Chrome to another profile at a limit, and the topics it moved follow their computers again when it ends.

### Русский

- **Профиль Claude для каждого компьютера.** В /devices компьютеру можно задать свой профиль Claude: его топики работают на нём со следующего сообщения, переписка переносится, а топик, перенесённый на другой компьютер, переходит на профиль того компьютера. Топик, где профиль выбран в /profile, остаётся на своём, с кнопкой вернуть как было.
- **Chrome на любом компьютере и в любом аккаунте.** Если попросить Chrome, до которого сессия топика не дотягивается (на другом компьютере или на этом, но вошедший в другой аккаунт Claude), Claude поручает задачу короткой сессии на аккаунте этого Chrome и получает результат со скриншотами. Переключать ничего не нужно.
- **Ночная смена и Chrome.** Ночная смена больше не переносит топик, работающий в Chrome, на другой профиль при исчерпании лимита, а перенесённые топики после смены возвращаются на профиль своего компьютера.

## 0.17.5

- **Night shifts move to another profile.** When a night shift runs into a limit, it carries on by itself on the signed-in profile with the most room left, instead of waiting for the reset. The morning card shows how much of the week each profile gave.
- **Agents on another profile.** With several Claude profiles, the head can start an agent on another one, so a team spends both limits in parallel.

### Русский

- **Ночная смена переходит на другой профиль.** Упёршись в лимит, ночная смена сама продолжает на профиле с выполненным входом, где больше всего свободного лимита, а не ждёт сброса. Утренняя карточка показывает, сколько недели ушло с каждого профиля.
- **Агенты на другом профиле.** Если профилей Claude несколько, хед может запустить агента на другом, и команда тратит оба лимита параллельно.

## 0.17.4

- **Topics kept for good.** The warning before a quiet topic is deleted has «Never delete it»: the topic and its Claude session stay with no more weekly warnings, and /delete still removes it by hand. One tap on the note undoes it.

### Русский

- **Топики, которые не удаляются.** В предупреждении перед удалением тихого топика есть «Никогда не удалять»: топик и сессия Claude остаются без еженедельных напоминаний, а вручную его по-прежнему удаляет /delete. Одна кнопка в подтверждении возвращает как было.

## 0.17.3

- **Skills from private repositories.** A link to your private GitHub repository installs like a public one: the bot clones it on the topic's computer with that computer's sign-in to GitHub, and nothing needs forwarding back to the chat.
- **Skills from a file on the computer.** Claude can also install a skill from a .zip, .skill or SKILL.md in the project.

### Русский

- **Скиллы из приватных репозиториев.** Ссылка на твой приватный репозиторий на GitHub ставится как публичная: бот клонирует его на компьютере топика под входом этого компьютера в GitHub, и пересылать архив обратно в чат не нужно.
- **Скиллы из файла на компьютере.** Claude может поставить скилл и из .zip, .skill или SKILL.md в проекте.

## 0.17.2

- **Sleep instead of off.** A night shift puts the computers to sleep instead of turning them off: open apps keep their work, and a sleeping computer can be woken from afar. Claude and agents can no longer turn a computer off or restart it with a command, even when asked in the chat.
- **An empty desktop in the morning.** The night shift card asks whether to tidy the desktop. If yes, the last shift on a computer closes its windows before it sleeps; an app asking to save stays open, and the chat says which.
- **Awake after a wake.** A computer woken from afar stays up for five minutes, so you have time to give it a task before Windows puts it back to sleep.

### Русский

- **Сон вместо выключения.** Ночная смена усыпляет компьютеры, а не выключает: открытые программы сохраняют работу, а спящий компьютер можно разбудить издалека. Claude и агенты больше не могут выключить или перезагрузить компьютер командой, даже если попросить в чате.
- **Пустой рабочий стол утром.** Карточка ночной смены спрашивает, убрать ли рабочий стол. Если да, последняя смена на компьютере закрывает окна перед сном; программа, которая просит сохранить, остаётся открытой, и в чате сказано какая.
- **Не засыпает после пробуждения.** Компьютер, разбуженный издалека, 5 минут не засыпает, чтобы ты успел дать задачу, прежде чем Windows снова его усыпит.

## 0.17.1

- **Claude drives the screen on a Mac too.** As on Windows: buttons and fields through the windows themselves while you work, a window seen even under others, the mouse and keyboard only while you are away. Needs the Xcode Command Line Tools, and Screen Recording and Accessibility for the agent in System Settings.
- **No clicks into the wrong window.** If Claude's window doesn't come to the front, it stops before clicking or typing instead of sending them to another app.

### Русский

- **Claude управляет экраном и на Mac.** Как на Windows: кнопки и поля через сами окна, пока ты работаешь, окно видно даже под другими, мышь и клавиатура — только пока ты отошёл. Нужны Xcode Command Line Tools, а для агента — «Запись экрана» и «Универсальный доступ» в Системных настройках.
- **Никаких кликов не в то окно.** Если окно Claude не вышло на передний план, он останавливается до клика или ввода, а не отправляет их в другую программу.

## 0.17.0

- **Claude drives the screen on Windows.** For what no tool reaches (an Open or Save dialog, an app without tools of its own), Claude asks for the screen with a card, like Chrome. Then it sees the windows it works in, clicks, types in any language and presses keys, and a live view with a stop button follows in the chat.
- **You and Claude at one computer.** Claude presses buttons, fills in fields and picks items through the windows themselves, without your mouse and keyboard, and sees its window even under yours, so you keep working. The mouse and keyboard it takes only after a minute without your input, gives the cursor and window back after, and stops the moment you touch them. «Work now» lets it go at once.
- **Out of sight on a virtual monitor.** With a virtual display turned on (Virtual Display Driver), Claude can move its windows there; they come back at the end of the task.

### Русский

- **Claude управляет экраном на Windows.** Для того, до чего не дотягиваются инструменты (окно «Открыть» или «Сохранить», программа без своих инструментов), Claude просит экран карточкой, как Chrome. Дальше он видит окна, в которых работает, кликает, печатает на любом языке и жмёт клавиши, а в чате идёт живой просмотр с кнопкой «Стоп».
- **Ты и Claude за одним компьютером.** Claude нажимает кнопки, заполняет поля и выбирает пункты через сами окна, без твоих мыши и клавиатуры, и видит своё окно даже под твоими, так что можно работать параллельно. Мышь и клавиатуру он берёт только после минуты без твоего ввода, потом возвращает курсор и окно на место и останавливается, как только ты их коснёшься. «Работай сейчас» — чтобы не ждал.
- **С глаз долой на виртуальный монитор.** Если включён виртуальный дисплей (Virtual Display Driver), Claude может унести туда свои окна; в конце задачи они возвращаются.

## 0.16.0

- **Lottie, stickers and emoji into SVG.** Claude turns any Lottie into SVG files, the first frame or any other, drawn by the same player Telegram uses on the web: Telegram's animated stickers and emoji (.tgs), plain JSON and dotLottie (.lottie, every animation in it, its images included). Send the files or stickers, or paste custom emoji into a message. The SVGs land in the project on the computer, ready to sort, rename or take into Figma or After Effects, or come to the chat as one zip.
- **A Lottie file in a line.** A Lottie JSON sent to the chat reaches Claude as its size and frames, not as tens of thousands of tokens of JSON.
- **Stickers you send reach Claude.** A sticker sent to the bot used to be ignored; now Claude gets its file and its emoji, and sees a still one.
- **Replies to stickers.** Reply to a sticker Claude sent and Claude knows which one it was and what file it made it from, so «redo this» works; a reply to anyone else's sticker brings its emoji and set.

### Русский

- **Lottie, стикеры и эмодзи в SVG.** Claude превращает любой Lottie в SVG-файлы: первый кадр или любой другой, нарисованный тем же плеером, что у Telegram в вебе. Анимированные стикеры и эмодзи Telegram (.tgs), обычный JSON и dotLottie (.lottie, все анимации в нём вместе с картинками). Присылай файлы или стикеры, или вставляй премиум-эмодзи в сообщение. SVG ложатся в проект на компьютере, их можно разложить, переименовать, перенести в Figma или After Effects, или придут в чат одним архивом.
- **Lottie-файл одной строкой.** Lottie JSON, присланный в чат, доходит до Claude как размер и число кадров, а не как десятки тысяч токенов JSON.
- **Стикеры, которые ты присылаешь, доходят до Claude.** Раньше бот их пропускал; теперь Claude получает файл и эмодзи стикера, а неанимированный видит.
- **Ответ на стикер.** Ответь на стикер, который прислал Claude, и он поймёт, какой это был стикер и из какого файла, так что «переделай» работает; для чужого стикера Claude узнаёт его эмодзи и набор.

## 0.15.2

- **Chrome stays on through the task.** Chrome that Claude asked for now goes off after 20 minutes without it, not after the first turn spent on something else: it was gone the moment Claude came back to the page.
- **Uploads in Chrome checked, not given up.** Claude checks by the page itself whether a site took a file, and when screenshots stall because Chrome is minimized, asks you to bring it to the front instead of telling you to upload by hand.

### Русский

- **Chrome не выключается посреди задачи.** Chrome, который просил Claude, теперь выключается через 20 минут без него, а не после первого хода, занятого другим: раньше он пропадал, как только Claude возвращался к странице.
- **Загрузка в Chrome проверяется, а не бросается.** Claude проверяет по самой странице, принял ли сайт файл, а когда скриншоты зависают из-за свёрнутого Chrome, просит развернуть окно, а не предлагает загрузить руками.

## 0.15.1

- **A new task, a new session.** When a topic's conversation is past 200k tokens and you start something unrelated to it, Claude offers a card before starting: a fresh session for the task (the same computer and project) or going on here. Every step rereads the whole conversation, so in a fresh one the task costs several times less.

### Русский

- **Новая задача — новая сессия.** Когда разговор в топике длиннее 200k токенов и ты начинаешь что-то с ним не связанное, Claude перед работой предлагает карточку: новая сессия для задачи (компьютер и проект те же) или продолжить здесь. Каждый шаг перечитывает весь разговор, поэтому в новой сессии задача обходится в разы дешевле.

## 0.15.0

- **Limit resets from /usage.** A button under /usage opens claude.ai's limits page on your computer, in the browser that goes through the server: there you see how many free resets you have and until when, and use one. Straight from the phone only with a warning that claude.ai then sees your own address.
- **New models without an update.** /model, the group settings and Claude's agents offer the models your account lists, the newest of each family: Fable 5.2 is there now, and the next one appears by itself. Topics and groups that chose an older version of a family move to its newest, and the effort buttons show only what the model takes.
- **A computer just switched on connects.** Its first message to the server is many times smaller now, and the server waits a minute for it instead of 10 seconds: a PC with many projects and app tools was cut off again and again while everything that starts with Windows filled its link. The bot no longer says such a computer is online for an instant, nor starts its put-off tasks on a link already gone.

### Русский

- **Сбросы лимита из /usage.** Кнопка под /usage открывает страницу лимитов claude.ai на твоём компьютере, в браузере, который ходит через сервер: там видно, сколько бесплатных сбросов и до какого числа, и там же их можно использовать. Прямо с телефона — только с предупреждением, что claude.ai тогда увидит твой адрес.
- **Новые модели без обновления.** /model, настройки группы и агенты Claude предлагают модели, которые доступны аккаунту, самую новую версию каждого семейства: уже есть Fable 5.2, а следующая появится сама. Топики и группы на старой версии семейства переходят на новую, а кнопки усилия показывают только то, что модель умеет.
- **Только что включённый компьютер подключается.** Его первое сообщение серверу теперь в разы меньше, а сервер ждёт его минуту, а не 10 секунд: PC с множеством проектов и инструментов программ раз за разом отрезало, пока всё, что стартует с Windows, забивало связь. Бот больше не объявляет такой компьютер в сети на мгновение и не запускает его отложенные задачи на уже оборванной связи.

## 0.14.1

- **Render errors in words.** A render that fails inside After Effects (a missing folder, an output module) now shows After Effects' own reason instead of "aerender stopped before the end".
- **Tidier render card.** The ring sits in the middle, a failed render shows no stray dot, and the file name no longer runs under the message time.

### Русский

- **Ошибки рендера словами.** Рендер, упавший внутри After Effects (нет папки, нет модуля вывода), теперь показывает причину от самого After Effects, а не «aerender остановился до конца».
- **Аккуратнее карточка рендера.** Кольцо по центру, у упавшего рендера нет лишней точки, имя файла больше не залезает под время сообщения.

## 0.14.0

- **Render progress.** When Claude starts an After Effects render in the background, the bot follows it by itself: in the private chat a widget with the percentage, the frames and the time left, then a tick or the error; in a group, one message that updates.
- **Night shift card.** In the morning the night shift sends a card instead of a line: when it ran, how much got done, what it took of the week's limit, and the lists of what is done and what is left.

### Русский

- **Прогресс рендера.** Когда Claude запускает рендер After Effects в фоне, бот сам следит за ним: в личке виджет с процентами, кадрами и оставшимся временем, в конце галочка или ошибка; в группе одно сообщение, которое обновляется.
- **Карточка ночной смены.** Утром ночная смена присылает карточку вместо строки: когда шла, сколько сделано, сколько ушло лимита недели, списки сделанного и оставшегося.

## 0.13.0

- **/now that keeps itself current.** In the private chat /now is a widget of what waits for you, what runs and what is queued, and it refreshes by itself while it is on screen; tap a line to open its topic.
- **/status as a card.** In the private chat /status shows the topic as a card: its state, computer, project, model and permissions; tap the project or the model for more. In groups it stays a table.
- **/usage as a widget.** In the private chat with the bot, /usage shows the limits as rings with the time to their reset, the week's spending by day and the costliest topics; tap a day to see its topics. In groups it stays text.

### Русский

- **/now, который обновляется сам.** В личке /now — виджет: что ждёт тебя, что работает и что в очереди; пока он на экране, он сам обновляется, а нажатие на строку открывает её топик.
- **/status карточкой.** В личке /status показывает топик карточкой: состояние, компьютер, проект, модель и разрешения; нажми на проект или модель, чтобы увидеть больше. В группах остаётся таблицей.
- **/usage виджетом.** В личке с ботом /usage показывает лимиты кольцами со временем до сброса, расход недели по дням и самые затратные топики; нажми на день, чтобы увидеть его топики. В группах остаётся текстом.

## 0.12.2

- **Widgets only when they help.** Claude answers in text by default and sends a widget only when you have to set something by hand, when the shape of the numbers is the point, or when you ask for one.

### Русский

- **Виджеты только по делу.** Claude по умолчанию отвечает текстом, а виджет присылает, только когда нужно что-то настроить руками, когда важна форма цифр или когда ты сам просишь.

## 0.12.1

- **Widgets built like Apple's.** Claude's widgets are now filled 320 by 320 squares by Apple's own rules for widgets: one subject, one of the layouts iOS widgets use (a ring, a chart, a list, a grid), SF Pro Rounded, the accent colour of your Telegram theme and smooth corners.

### Русский

- **Виджеты по правилам Apple.** Виджеты Claude теперь заполненные квадраты 320×320 по правилам Apple для виджетов: одна тема, одна из раскладок, как у виджетов iOS (кольцо, график, список, сетка), SF Pro Rounded, акцентный цвет твоей темы Telegram и сглаженные углы.

## 0.12.0

- **Widgets.** In the private chat with the bot Claude answers with an interactive widget in the style of iOS widgets when that says more than text, on its own: a render's status, numbers at a glance, a comparison, an easing curve to drag, colors. What you set in one and confirm with its button comes back to Claude as your message. Claude follows Telegram's own rules for widgets. Groups get them once Telegram allows it there.

### Русский

- **Виджеты.** В личке с ботом Claude сам отвечает интерактивным виджетом в стиле виджетов iOS, когда так нагляднее, чем текстом: статус рендера, цифры одним взглядом, сравнение, кривая easing, которую можно потянуть, цвета. То, что ты настроил и подтвердил кнопкой виджета, возвращается Claude как твоё сообщение. Claude следует официальным правилам Telegram для виджетов. В группах появятся, когда Telegram их там разрешит.

## 0.11.0

- **Skills.** Ask Claude to install a skill and send it as a `.zip`, `.skill` or `SKILL.md` file, or as a GitHub link to its folder. You see what it is and pick where it goes with a button: everywhere, all projects of this computer, or this project only. Claude reads a skill when a task fits it and runs its scripts on the computer.
- **Skills of a project and of a computer.** Skills in a project's `.claude/skills` folder and in `~/.tg-claude-vps/skills` on a computer are used too. A project's new skill waits for your word, like a new `CLAUDE.md`.

### Русский

- **Скиллы.** Попроси Claude установить скилл и пришли его файлом `.zip`, `.skill` или `SKILL.md` или ссылкой на его папку на GitHub. Ты увидишь, что это, и выберешь кнопкой, куда его поставить: везде, во все проекты этого компьютера или только в этот проект. Claude читает скилл, когда задача подходит, и запускает его скрипты на компьютере.
- **Скиллы проекта и компьютера.** Скиллы из папки `.claude/skills` проекта и из `~/.tg-claude-vps/skills` на компьютере тоже используются. Новый скилл проекта ждёт твоего согласия, как новый `CLAUDE.md`.

## 0.10.5

- **/usage names removed agents.** The week's tokens of an agent that has been removed are shown under its name, not as a number of its deleted topic.

### Русский

- **/usage называет удалённых агентов.** Токены агента, которого уже удалили, показываются под его именем, а не номером удалённого топика.

## 0.10.4

- **Reply buttons outlive agents' reports.** The head answering an agent's report or a scheduled task no longer takes away the buttons of its last answer to you; they pass when you write something else or the head offers new ones.

### Русский

- **Кнопки ответа не пропадают из-за отчётов агентов.** Когда хед отвечает на отчёт агента или задачу по расписанию, кнопки его последнего ответа тебе остаются; они уходят, когда ты пишешь что-то своё или хед предлагает новые.

## 0.10.3

- **A clearer team board.** Each agent shows its state and for how long, what it works on as the head named it and the step it is at; no more scraps of reports.
- **One pinned board.** After a restart the board is edited in place instead of being sent and pinned again; a board that has to be sent anew replaces the old one.

### Русский

- **Понятнее доска команды.** У каждого агента видно состояние и сколько оно длится, над чем он работает по подписи хеда и на каком он шаге; обрывков отчётов больше нет.
- **Один закреп.** После перезапуска доска правится на месте, а не отправляется и закрепляется заново; если отправить её всё же приходится, новая заменяет старую.

## 0.10.2

- **Gone groups cleared whole.** A group the bot is no longer in is now cleared with its general chat and its record, also when the bot finds it gone at start.
- **/usage: the tokens of the week as a table.** Topic and share with a bar; topics of the same name say which group they are in.

### Русский

- **Ушедшие группы убираются целиком.** Группа, где бота больше нет, теперь убирается вместе с общим чатом и записью о ней, в том числе если бот обнаружил это при запуске.
- **/usage: токены за неделю — таблицей.** Топик и доля с полоской; у топиков с одинаковым именем указана группа.

## 0.10.1

- **Groups the bot has left are cleared.** When Telegram says a group is gone for the bot (it was removed or the group deleted), its topics and the group are cleared from the server instead of being tried every day.

### Русский

- **Группы, из которых бот ушёл, убираются.** Если Telegram отвечает, что группы для бота больше нет (его удалили или группу удалили), её топики и сама группа убираются с сервера, а не пробуются каждый день.

## 0.10.0

- **Answer an agent from its report.** Reply in the head's topic to an agent's report and your message goes straight to that agent; the head isn't woken to pass it on.
- **«Online» only when it matters.** A computer coming back is announced only if you ran into it being off lately. A closed Mac waking at night no longer sends «Home Mac is online» every hour.
- **A button when an app hangs.** If a call to After Effects, Blender or Roblox Studio waits for 3 minutes, a card offers to restart its bridge: the stuck call ends and Claude tries again.
- **A team board in the head.** A pinned message in the head's topic shows each agent and what it is doing, and updates by itself.
- **Where the tokens went.** /usage lists the topics that spent the most over the last 7 days.
- **A word about a costly topic.** A topic that spends about a tenth of the week in one day says so once, with buttons to compact its history or switch it to Sonnet.
- **Continue with one tap.** An answer that was stopped or ended with an error has a «Continue» button.
- **Long commands in the background.** Claude can start a command that runs longer than 30 minutes, such as a full test run, in the background and read its log later, instead of waiting and starting it over.
- **Night shifts wrap up at 5:00.** From then on a shift starts nothing long, finishes what is quick and sums up, so the computers go off well before the morning. The wrap-up and the morning call now reach a head even in the middle of a long turn.
- **Night shifts turn the computer off forcibly.** Apps are closed without saving, so an app asking «Save changes?» no longer keeps the computer on until morning; the shift saves its work before it ends. If a computer is still on 10 minutes after the order, you are told.

### Русский

- **Ответ агенту прямо из отчёта.** Ответь в топике хеда на отчёт агента, и сообщение уйдёт сразу этому агенту, без хеда.
- **«В сети» только по делу.** О подключении компьютера бот пишет, только если ты недавно натыкался на то, что он выключен. Закрытый Mac, просыпающийся ночью, больше не шлёт «Home Mac в сети» каждый час.
- **Кнопка при зависшем приложении.** Если вызов к After Effects, Blender или Roblox Studio ждёт 3 минуты, приходит карточка с кнопкой перезапустить мост: зависший вызов завершится, и Claude попробует снова.
- **Доска команды в хеде.** Закреплённое сообщение в топике хеда показывает каждого агента и чем он занят и обновляется само.
- **Куда ушли токены.** /usage показывает топики, потратившие больше всего за 7 дней.
- **Предупреждение о дорогом топике.** Если топик за день потратил около десятой части недели, бот один раз скажет об этом и предложит сжать историю или перевести его на Sonnet.
- **Продолжить одним нажатием.** Под ответом, остановленным или завершившимся с ошибкой, есть кнопка «Продолжай».
- **Долгие команды в фоне.** Claude может запустить команду дольше 30 минут, например полную проверку тестами, в фоне и прочитать её лог позже, а не ждать и перезапускать её заново.
- **Ночная смена сворачивается в 5:00.** После этого смена не начинает ничего долгого, доделывает быстрое и подводит итог, так что компьютеры выключаются задолго до утра. Сигнал свернуться и утренний вызов теперь доходят до хеда даже посреди долгого хода.
- **Ночная смена выключает компьютер принудительно.** Программы закрываются без сохранения, так что программа с вопросом «Сохранить изменения?» больше не держит компьютер включённым до утра; смена сохраняет работу перед концом. Если через 10 минут после команды компьютер всё ещё включён, бот об этом скажет.

## 0.9.12

- **The daily backup no longer fails on busy sessions.** A session written to while the copy was made stopped the whole backup with «file changed as we read it». The copy now goes through, with that file as it was at that moment.

### Русский

- **Ежедневная резервная копия больше не срывается из-за активных сессий.** Если сессия менялась во время копирования, вся копия падала с «file changed as we read it». Теперь копия проходит, а этот файл попадает в неё таким, каким был в тот момент.

## 0.9.11

- **The question above the reply buttons.** When Claude suggests replies, the question they answer now stands right above the buttons, in a line of its own with ❓, so you can answer without looking for it in the text. Three replies go two side by side and the last across.

### Русский

- **Вопрос над кнопками-ответами.** Когда Claude предлагает варианты ответа, вопрос, на который они отвечают, теперь стоит прямо над кнопками отдельной строкой с ❓: можно ответить, не ища его в тексте. Три варианта идут два в ряд и третий во всю ширину.

## 0.9.10

- **Reactions say what you liked.** 🔥 on an answer means you loved it, 👍 and ❤️ that you liked it: Claude hears of it with your next message in that topic, without a turn of its own and its cost. 👎 still asks it to look again.

### Русский

- **Реакции говорят, что понравилось.** 🔥 на ответе значит «очень понравилось», 👍 и ❤️ — «понравилось»: Claude узнаёт об этом с твоим следующим сообщением в топике, без отдельного хода и его расхода. 👎 по-прежнему просит его пересмотреть ответ.

## 0.9.9

- **Pictures in answers come through more often.** A picture or video from another project on the same computer now comes through that project, instead of «outside the project». One that isn't on the disk yet (a render or a merge still writing it) is looked for again a minute later and sent as a message of its own if it turned up. Claude also checks a file is there before it names it.

### Русский

- **Картинки в ответах доходят чаще.** Картинка или видео из другого проекта на том же компьютере теперь приходит через тот проект, а не падает с «вне проекта». Если файла ещё нет на диске (его дописывает рендер или вливание), бот через минуту смотрит снова и присылает его отдельным сообщением, если он появился. И Claude теперь проверяет, что файл на месте, прежде чем на него сослаться.

## 0.9.8

- **Agents can set up scheduled tasks.** Ask an agent for a regular run, such as an ads report, and it proposes it in its own topic like any other; before, it couldn't and sent you to /schedule, which can't create tasks. Its scheduled runs answer you in its topic and don't wake the head.

### Русский

- **Агенты умеют ставить задачи по расписанию.** Попроси агента о регулярном запуске, например отчёте по рекламе, и он предложит его в своём топике, как обычно. Раньше он не мог и отправлял тебя в /schedule, где задачи не создаются. Его плановые запуски отвечают тебе в его топике и не будят хеда.

## 0.9.7

- **Scheduled tasks with your Chrome.** A task that needs a site you are signed in to, such as an ads dashboard, can now run by itself: Claude marks it «with Chrome» when it proposes it, and Chrome turns on in the topic for each run only, then off again. If no browser is linked to that computer, the report says so.

### Русский

- **Задачи по расписанию с твоим Chrome.** Задача, которой нужен сайт, где ты вошёл (например, рекламный кабинет), теперь может идти сама: Claude помечает её «с Chrome», когда предлагает, и Chrome включается в топике только на время запуска, а потом выключается. Если к этому компьютеру браузер не привязан, отчёт об этом скажет.

## 0.9.6

- **Pictures from the right worktree.** When Claude names a file in one of an agent's worktrees but it lies at the same place in another one of the same repository, the picture is found there instead of «No such file».

### Русский

- **Картинки из нужного ворктри.** Если Claude указал файл в одном ворктри агента, а он лежит на том же месте в другом ворктри того же репозитория, картинка находится там, а не падает с «No such file».

## 0.9.5

- **Fewer task lists from voice messages.** A voice message with up to three tasks goes as it was said, without a card. The list to tick comes only from four tasks up.

### Русский

- **Меньше списков из голосовых.** Голосовое, в котором до трёх задач, уходит как сказано, без карточки. Список с галочками появляется только от четырёх задач.

## 0.9.4

- **Computers update through a shaky connection.** When a computer can't reach GitHub for its update (the connection drops), it tries again by itself, and the bot tries again a few times quietly before telling you. The message no longer blames a missing git sign-in when it was only the connection.

### Русский

- **Компьютеры обновляются и при неровной связи.** Если компьютер не может достучаться до GitHub за обновлением (обрывается связь), он сам пробует ещё раз, а бот тихо повторяет попытку несколько раз и только потом пишет тебе. Сообщение больше не винит вход в git, когда дело было только в связи.

## 0.9.3

- **/schedule, easier to read.** Each task sits in a block of its own, one line each for how often, the next run and the topic.

### Русский

- **/schedule читается легче.** Каждая задача в своём блоке, по строке на то, как часто она идёт, следующий запуск и топик.

## 0.9.2

- **A clearer /schedule.** Each task says when it runs in words («every day at 11:00 and 22:00» instead of `0 11,22 * * *`), the next run as «today at 22:00», and the topic it runs in. The buttons say what they do and which task they act on, and the time zone shows as UTC+4.

### Русский

- **Понятный /schedule.** У каждой задачи расписание словами («каждый день в 11:00 и 22:00» вместо `0 11,22 * * *`), следующий запуск как «сегодня в 22:00» и топик, где она идёт. Кнопки говорят, что делают и с какой задачей, а часовой пояс показан как UTC+4.

## 0.9.1

- **Files from Telegram come through a shaky connection.** A video, voice message or file whose download dropped («fetch failed») now gets three tries in all; if it still doesn't come through, the bot says so in plain words.

### Русский

- **Файлы из Telegram доходят и при неровной связи.** Если скачивание видео, голосового или файла оборвалось («fetch failed»), бот теперь делает до трёх попыток, а если не вышло — пишет об этом понятными словами.

## 0.9.0

- **Fewer tokens on long conversations.** Every step of Claude rereads the whole history, and that was most of what the weekly limit went on. A topic's history is now offered for compacting at 500k tokens and compacts by itself near 700k, instead of near 1M. Agents compact by themselves near 500k, without asking.
- **Agents on Sonnet by default.** The head now keeps Opus for the hard parts only: designing something new, a bug Sonnet couldn't crack, delicate refactoring.

### Русский

- **Меньше токенов на длинных разговорах.** Каждый шаг Claude перечитывает всю историю, и на это уходила большая часть недельного лимита. Теперь бот предлагает сжать историю топика на 500 тыс. токенов, а сама она сжимается около 700 тыс., а не около 1 млн. Агенты сжимаются сами около 500 тыс., без вопросов.
- **Агенты по умолчанию на Sonnet.** Хед оставляет Opus только для сложного: проектирования нового, бага, который Sonnet не осилил, тонкого рефакторинга.

## 0.8.11

- **What waits is clear.** When you answer a card (Chrome access, staying on this computer, an agent elsewhere, going on despite the limit) while Claude is busy, the card itself gets 👀, and ⚡ on it hands it in, instead of a bare “Queued” message that didn't say what.

### Русский

- **Понятно, что ждёт.** Если ответить на карточку (доступ к Chrome, остаться на этом компьютере, агент на другом, продолжить несмотря на лимит), пока Claude занят, 👀 ставится на саму карточку, и ⚡ на ней передаёт ответ сразу. Раньше приходило голое «В очереди», непонятно про что.

## 0.8.10

- **A voice message's list of tasks doesn't hold up the work.** If you don't touch the card for a minute, the voice message goes as it was said, and the card says so. Once you start unticking tasks, it waits for your choice.

### Русский

- **Список задач из голосового больше не стопорит работу.** Если минуту не трогать карточку, голосовое уйдёт как сказано, и карточка об этом напишет. Если начал снимать галочки, она ждёт твоего выбора.

## 0.8.9

- **A removed agent's folder that is still open somewhere.** When Windows won't delete it because Roblox Studio, an editor or a terminal holds it, the bot says so in plain words and deletes the empty folder by itself once it's free, instead of showing git's error.

### Русский

- **Папка удалённого агента, которая ещё где-то открыта.** Если Windows не даёт её удалить, потому что её держит Roblox Studio, редактор или терминал, бот говорит об этом понятными словами и сам удаляет пустую папку, когда она освободится, вместо того чтобы показывать ошибку git.

## 0.8.8

- **Corrections reach a busy agent at once.** When you add to a task the head has already handed out, the head passes it into the agent's work under way, marked ⚡, instead of queueing it after the turn. The agent no longer finishes the old version first and then redoes it; a new, separate task still waits its turn.

### Русский

- **Уточнения доходят до занятого агента сразу.** Если ты дополняешь задачу, которую хед уже раздал, хед передаёт уточнение агенту прямо в текущую работу, с ⚡, а не ставит в очередь после хода. Агент больше не доделывает старую версию, чтобы потом переделывать; новая отдельная задача по-прежнему ждёт своей очереди.

## 0.8.7

- **Uploads in Chrome, for real.** The file from 0.8.6 reached the server but Chrome still turned it down; now it goes into the page.

### Русский

- **Загрузка в Chrome, теперь по-настоящему.** В 0.8.6 файл доходил до сервера, но Chrome всё равно его не принимал; теперь он попадает на страницу.

## 0.8.6

- **Uploads in Chrome from the computer.** Claude can now put a file from your computer into a page's upload field, such as a game icon on Creator Hub. Chrome ran on the server's side of things and couldn't read files on your computer; the file now comes over first.

### Русский

- **Загрузка файлов с компьютера в Chrome.** Claude теперь может загрузить файл с твоего компьютера на страницу, например иконку игры в Creator Hub. Раньше Chrome не мог прочитать файлы с компьютера, потому что загрузка шла со стороны сервера; теперь файл сначала переносится туда.

## 0.8.5

- **No more /night.** It was easy to take for a night shift, and it stayed on until someone turned it off. A night shift starts from your words, in text or a voice message, and keeping it to branches is a button on its card. Night mode left on by /night turns off with the update.

### Русский

- **Команды /night больше нет.** Её легко было спутать с ночной сменой, и она оставалась включённой, пока её не выключат. Ночная смена запускается твоими словами, текстом или голосом, а «только ветки» — кнопка на её карточке. Ночной режим, оставленный /night, выключится с обновлением.

## 0.8.4

- **Pushes in a night shift.** A shift allows merging and releasing unless you ask to keep it in branches. One kept to branches that runs into a refused push shows a button to allow it for the rest of the night, instead of asking you to turn off /night.
- **The computer turns off when a shift ends in the night.** Done or not, once nothing of the shift runs any more: until now an unfinished shift kept it on till morning. Only work left at the 9:00 call keeps it on, for you to go on.
- **A missed task can wait for its computer.** A task on a schedule that came while the computer was off now has a button to run it when the computer connects, one-time tasks too.

### Русский

- **Пуши в ночной смене.** Смена разрешает мёрж и выпуск, если ты не попросил держать всё в ветках. Если смена в ветках упрётся в запрет пуша, придёт кнопка, чтобы разрешить его до конца ночи, вместо просьбы выключить /night.
- **Компьютер выключается, когда смена закончилась ночью.** Доделала она всё или нет, как только в ней ничего не работает: раньше недоделанная смена держала его включённым до утра. Включённым его оставляет только работа, недоделанная к 9:00, чтобы ты её продолжил.
- **Пропущенная задача может дождаться компьютера.** У задачи по расписанию, которая пришлась на выключенный компьютер, теперь есть кнопка, чтобы запустить её, когда он подключится, в том числе у разовой.

## 0.8.3

- **Several night shifts on one computer.** When two shifts work on the same computer, the first to finish leaves it on and says so; the last one to finish turns it off.

### Русский

- **Несколько ночных смен на одном компьютере.** Если две смены работают на одном компьютере, первая закончившая оставляет его включённым и говорит об этом, а выключает последняя.

## 0.8.2

- **Frames from After Effects and Blender in answers.** A picture an app's MCP returned can now be shown in Claude's answer, instead of "couldn't attach".
- **Messages that read at a glance.** The bot's own messages are in rich text with headings and short lines instead of paragraphs: the wait before an update, /model, where a topic works, a computer that is off, /quiet, /night, an empty team, how an update goes.

### Русский

- **Кадры из After Effects и Blender в ответах.** Картинку, которую вернул MCP приложения, Claude теперь может показать в ответе, а не «Не удалось приложить».
- **Сообщения, которые читаются с одного взгляда.** Служебные сообщения бота теперь в rich-тексте, с заголовками и короткими строками вместо абзацев: ожидание перед обновлением, /model, где работает топик, компьютер не в сети, /quiet, /night, пустая команда агентов, как пройдёт обновление.

## 0.8.1

- **Linux computers.** The Mac's line from /pair installs the agent on Linux too, and it starts with your session through systemd and restarts after a crash or an update. "Stays awake during tasks" works there, and so does turning the computer off after a night shift.

### Русский

- **Компьютеры на Linux.** Строка для Mac из /pair ставит агента и на Linux: он запускается вместе с твоим сеансом через systemd и перезапускается после сбоя или обновления. Там работают «Не засыпать во время задач» и выключение после ночной смены.

## 0.8.0

- **Night shift.** Tell a head topic it is its night shift and list the tasks: a card shows them, and one tap starts it. All night it works with no questions to you, can bring in helpers, accepts its agents' work as a customer would, has visual work looked at by two or three reviewers, and fixes what it finds within its tasks.
- **One summary in the morning.** When the work is done, the summary comes quietly: what was done and released, the head's decisions with their reasons, what it noticed but left alone, before and after pictures. Then the computers turn off if you asked, and at 9:00 there is one push with a sound.
- **Branches only, if you like.** A button on the card keeps all of it in branches, as /night always did.

### Русский

- **Ночная смена.** Скажи топику-хеду, что это его ночная смена, и перечисли задачи: карточка их покажет, а смена начнётся одним нажатием. Всю ночь он работает без вопросов к тебе, может звать помощников, принимает работу агентов как заказчик, отдаёт визуал на проверку двум-трём проверяющим и сам чинит найденное в рамках своих задач.
- **Одна сводка утром.** Когда работа готова, сводка приходит без звука: что сделано и выпущено, решения хеда с причинами, что он заметил, но не трогал, картинки «до и после». Потом компьютеры выключаются, если ты просил, а в 9:00 приходит один пуш со звуком.
- **Только ветки, если хочешь.** Кнопка на карточке оставляет всё в ветках, как всегда делал /night.

## 0.7.3

- **The plan on top.** A task's plan now leads its live status, above the latest steps, and updating it no longer shows up as a step of its own.

### Русский

- **План сверху.** План задачи теперь стоит в самом начале её живого статуса, над последними шагами, а его обновления больше не видны отдельным шагом.

## 0.7.2

- **A plus for what waits.** A step of a plan that is still to come is marked ➕ now, instead of a timer.

### Русский

- **Плюс для того, что впереди.** Шаг плана, до которого ещё не дошло, теперь отмечен ➕ вместо таймера.

## 0.7.1

- **The cloud in /computer.** With your computer off, a topic can go on in the cloud with its conversation. A project of the same name there takes it at once; otherwise you pick one of the cloud's projects, or clone the repository there, and nothing is cloned before your tap. Claude may offer the cloud too when the topic's computer is off.
- **The checklist where you look.** The steps of a long task now show in its live status, above the latest steps, and then folded in its answer, marked when the task was cut off. No message of its own any more.
- **No move under an agent's feet.** When a computer comes online, the bot no longer offers to move a cloud project that an agent works in or a task is running in, and /move refuses it until the agent is removed.

### Русский

- **Облако в /computer.** Когда твой компьютер выключен, топик может продолжить работу в облаке вместе с разговором. Проект с тем же именем там подхватывает топик сразу, иначе выбираешь один из облачных проектов или клонируешь туда репозиторий, и без твоего нажатия ничего не клонируется. Claude тоже может предложить облако, если компьютер топика выключен.
- **Чек-лист там, куда ты смотришь.** Шаги длинной задачи теперь видны в её живом статусе, над последними шагами, а потом свёрнуты в ответе, с пометкой, если задача оборвалась. Отдельного сообщения больше нет.
- **Перенос не выдернет проект из-под агента.** Когда компьютер выходит в сеть, бот больше не предлагает перенести облачный проект, в котором работает агент или идёт задача, а /move отказывает, пока агент не удалён.

## 0.7.0

- **A spent limit doesn't end the work.** When Claude's limit runs out, the task waits and goes on by itself after the reset, even through a restart of the server. What you write meanwhile waits behind it, and a button or /stop lets it go.
- **Big tasks wait for a fresh limit.** When the 5-hour limit is 80% used or the weekly one 90%, Claude asks before a big task whether to wait for the reset. Put off, it starts by itself, and the topic stays free meanwhile.
- **A stuck task tells on itself.** The same error or the same step over and over, or no progress for long: an agent's head hears of it while it still runs, and in any other topic you get a message with a button to stop it. An agent that runs into the limit tells its head too.
- **Agents that follow each other.** The head can start an agent that waits for another and gets its report. If the first fails, the next doesn't start.
- **A live checklist.** The steps of a long task show as one message that ticks itself off, and says so if the task was cut off.
- **A correction becomes a rule.** Say the same thing twice and Claude offers to write it into the project's `CLAUDE.md`, on your tap only.
- **No sleep during a task.** A switch on each computer's card in /devices keeps it from sleeping while a task runs: on for a Mac, off for a PC. The screen still goes dark.
- **Settings to another computer.** A computer's card offers its MCP servers and global instructions to another one, each on a tap. Keys stay where they are.
- **Merged worktrees go.** Folders of merged branches with nothing uncommitted are offered for removal, or removed by themselves once you say so.
- **A head on a computer that is off reads its agents.** Reports from agents elsewhere no longer wait for the head's computer, and your words don't wait behind them.
- **Quiet mode.** `/quiet` turns pushes off for a chat, except when you are needed or all is done: permissions, questions, surveys, failed tasks and the final answer of a topic. Agents and their reports stay silent.
- **A long voice message becomes a list.** When you dictate several tasks at once, the bot shows them as a card with ticks. Run the ones you choose, send it as it was said, or cancel: nothing starts before your tap.
- **Forward as a task.** Forward a message to the bot, with or without your own words: text, a picture, a file or an album. Claude sees who it came from and when, and doesn't take instructions inside it for yours.
- **Animations as stickers.** A TGS or Lottie file Claude shows in its answer now arrives as a real animated sticker. One that doesn't fit Telegram's rules comes as a file, with the reason in plain words.
- **Health address.** `/health` on your server answers 200 while the bot hears from Telegram and 503 when it hasn't for 2 minutes, so UptimeRobot or a similar monitor can tell you when the server is down. The README says how to add it.

### Русский

- **Исчерпанный лимит не обрывает работу.** Когда лимит Claude кончается, задача ждёт и сама продолжается после сброса, даже если сервер перезапустится. То, что пишешь в это время, ждёт за ней, а кнопка или /stop её отпускают.
- **Большие задачи ждут свежий лимит.** Когда 5-часовой лимит израсходован на 80% или недельный на 90%, Claude перед большой задачей спрашивает, не подождать ли сброса. Отложенная задача начнётся сама, а топик пока свободен.
- **Зависшая задача сообщает о себе.** Одна и та же ошибка или шаг раз за разом либо долго нет прогресса: у агента об этом узнаёт хед, пока тот ещё работает, а в обычном топике тебе приходит сообщение с кнопкой остановки. Агент, упёршийся в лимит, тоже сообщает хеду.
- **Агенты друг за другом.** Хед может запустить агента, который ждёт другого и получает его отчёт. Если первый не справился, следующий не стартует.
- **Живой чек-лист.** Шаги длинной задачи видны одним сообщением, которое отмечается само и говорит, если задача оборвалась.
- **Правка становится правилом.** Скажи одно и то же дважды, и Claude предложит записать это в `CLAUDE.md` проекта, только по твоему нажатию.
- **Без сна во время задачи.** Переключатель в карточке компьютера в /devices не даёт ему уснуть, пока идёт задача: на Маке включён, на ПК выключен. Экран всё равно гаснет.
- **Настройки на другой компьютер.** Карточка компьютера предлагает перенести его MCP-серверы и общие инструкции на другой, каждое по нажатию. Ключи остаются на месте.
- **Смёрженные рабочие копии убираются.** Папки смёрженных веток без незакоммиченного бот предлагает удалить или, если скажешь, удаляет сам.
- **Хед на выключенном компьютере читает своих агентов.** Отчёты агентов с других компьютеров больше не ждут компьютер хеда, а твои сообщения не ждут за ними.
- **Тихий режим.** `/quiet` выключает уведомления в чате, кроме случаев, когда нужен ты или всё готово: разрешения, вопросы, опросы, упавшие задачи и итоговый ответ топика. Агенты и их отчёты приходят тихо.
- **Длинное голосовое становится списком.** Если надиктовать сразу несколько задач, бот покажет их карточкой с галочками. Запусти выбранные, отправь как сказано или отмени: без твоего нажатия ничего не начнётся.
- **Пересылка как задача.** Перешли сообщение боту, со своими словами или без: текст, картинку, файл или альбом. Claude видит, от кого оно и когда, и не считает инструкции внутри твоими.
- **Анимации как стикеры.** Файл TGS или Lottie, который Claude показывает в ответе, теперь приходит настоящим анимированным стикером. Если он не подходит под правила Telegram, придёт файлом, с причиной простыми словами.
- **Адрес проверки.** `/health` на твоём сервере отвечает 200, пока бот слышит Telegram, и 503, если не слышит уже 2 минуты: UptimeRobot или похожий монитор сообщит, когда сервер упал. Как его добавить, написано в README.

## 0.6.8

- **Lock button.** `/lock` stops everything and locks all your computers: their agents refuse every command, updates included. Only someone at the computer can undo it, by deleting one file, so a stolen account or a hacked server can't.
- **Command journal.** Each computer now records what it was asked to do, with the full command, in `agent.audit.log` next to its settings. File contents and known keys stay out of it.
- **A message about SSH logins.** A new server sends you a message directly from the VPS on a login from an address not seen for 30 days, even if the bot is stopped.
- **Groups without topics.** Add the bot to any group as an admin and the whole group works as one conversation, with no /workspace and no Topics to turn on. Turn Topics on later and the conversation stays in General, with topics and agents now on hand.
- **Pictures from worktrees.** A picture or file Claude names from a git worktree now arrives, instead of "No such file". If several branches have it, the newest copy goes.

### Русский

- **Кнопка блокировки.** `/lock` останавливает всё и блокирует все компьютеры: их агенты отказывают в любых командах, включая обновления. Снять блокировку можно только за самим компьютером, удалив один файл, поэтому угнанный аккаунт или взломанный сервер этого не сделают.
- **Журнал команд.** Каждый компьютер теперь записывает, что его просили сделать, с полным текстом команды, в `agent.audit.log` рядом со своими настройками. Содержимое файлов и известные ключи туда не попадают.
- **Сообщение о входе по SSH.** Новый сервер присылает сообщение прямо с VPS при входе с адреса, которого не было 30 дней, даже если бот остановлен.
- **Группы без тем.** Добавь бота админом в любую группу, и вся она работает как один разговор, без /workspace и без включения тем. Включишь темы позже: разговор останется в General, а топики и агенты станут доступны.
- **Картинки из рабочих копий.** Картинка или файл, которые Claude указал из рабочей копии git, теперь приходят, а не дают «No such file». Если файл есть в нескольких ветках, придёт самая новая копия.

## 0.6.7

- **Nothing to hurry on the update card.** The update goes by itself within 3 minutes, so "Update now" is gone. One button stays: cancel, for a tap made by mistake.

### Русский

- **На карточке обновления нечего торопить.** Обновление само идёт в пределах 3 минут, поэтому «Обновить сейчас» убрано. Осталась одна кнопка: отменить, на случай случайного нажатия.

## 0.6.6

- **A new CLAUDE.md asks first.** A project's instructions go in as your own words, and a cloned repository's were written by someone else. A text the bot hasn't seen waits for one tap, and the work goes on without it. Everything already on your computers counts as approved.
- **Pictures Telegram refuses.** A very long picture no longer leaves `![](tg://photo…)` in the chat: the text and the files arrive properly, each file with its caption.
- **The Ultra plan.** /profile, /profiles and /usage show the plan by the name the account has, such as Ultra, where the older word said Max.
- **A task waits out a short drop.** When a computer drops off for a moment, the next step waits up to a minute for it instead of ending the task with an error. The status says it is waiting.

### Русский

- **Новый CLAUDE.md сначала спрашивает.** Инструкции проекта идут как твои собственные слова, а в клонированном репозитории их написал кто-то другой. Текст, которого бот ещё не видел, ждёт одного нажатия, а работа идёт без него. Всё, что уже есть на твоих компьютерах, считается проверенным.
- **Картинки, которые Telegram не принял.** Очень длинная картинка больше не оставляет в чате `![](tg://photo…)`: текст и файлы приходят как надо, у каждого файла своя подпись.
- **Тариф Ultra.** /profile, /profiles и /usage показывают тариф так, как он называется у аккаунта, например Ultra, где раньше было Max.
- **Задача переживает короткий обрыв.** Когда компьютер ненадолго пропадает, следующий шаг ждёт его до минуты, а не завершает задачу ошибкой. В статусе видно, что идёт ожидание.

## 0.6.5

- **Reports back in a folding quote.** Agents' reports and letters between topics are a quote with an arrow again, now with bold, code and links. A table turns into plain lines.
- **A push when a computer is back.** A computer that was away for 5 minutes or more says it is online once it has stayed for a minute. A laptop waking for a moment and an update's restart say nothing.
- **Buttons in the message.** The cards of /now and of a waiting update have their buttons in the message itself.
- **A clearer note after a restart.** A topic waiting for a command says on which computer it runs and that it won't run twice, without the raw command.

### Русский

- **Отчёты снова в цитате со стрелкой.** Отчёты агентов и письма между топиками снова сворачиваются в цитату, теперь с жирным, кодом и ссылками. Таблица становится обычными строками.
- **Пуш, когда компьютер вернулся.** Компьютер, которого не было 5 минут и больше, сообщает, что он в сети, когда пробудет на связи минуту. Ноутбук, проснувшийся на мгновение, и перезапуск при обновлении ничего не присылают.
- **Кнопки внутри сообщения.** У карточек /now и ожидания обновления кнопки теперь внутри самого сообщения.
- **Понятнее заметка после перезапуска.** Топик, который ждёт команду, пишет, на каком компьютере она идёт и что второй раз не запустится, без сырого текста команды.

## 0.6.4

- **Decisions on your word only.** Claude records a decision when you say "remember" or "record it", and may ask first if something looks important. Picking an option in a working question stays in that task.
- **Reports in real formatting.** Agents' reports and letters between topics show headings, tables and code as they should, with the opening in sight and the rest under an arrow.
- **Put-off tasks by name.** A task waiting for a computer shows a short name in your language, with its full text under an arrow.
- **The queue in /now.** The card also shows messages waiting in line and tasks waiting for a computer.
- **Links with names.** Claude writes a link as a name you can tap, and a bare address only when you need the address itself.

### Русский

- **Решения только по твоему слову.** Claude записывает решение, когда ты говоришь «запомни» или «запиши», и может сначала спросить, если что-то выглядит важным. Выбор варианта в рабочем вопросе остаётся внутри задачи.
- **Отчёты с настоящим форматированием.** В отчётах агентов и письмах между топиками нормально выглядят заголовки, таблицы и код. Начало видно сразу, остальное под стрелкой.
- **Отложенные задачи с названием.** Задача, которая ждёт компьютер, показывает короткое название на твоём языке, а полный текст спрятан под стрелкой.
- **Очередь в /now.** Карточка показывает ещё сообщения в очереди и задачи, которые ждут компьютер.
- **Ссылки с названиями.** Claude пишет ссылку как название, на которое можно нажать, а голый адрес оставляет, только когда нужен сам адрес.

## 0.6.3

- **A failed update no longer deafens the bot.** An update that failed within a minute of a restart could leave the bot silent for up to 30 minutes.
- **A task survives a second crash.** A crash right after "Continuing it" no longer loses the task.
- **Big pictures arrive with the answer.** A picture over 10 MB comes as a file inside the answer.
- **Clearer failures.** A lost sign-in is no longer called a spent limit, and raw technical errors are gone from the chat.

### Русский

- **Сбой обновления больше не глушит бота.** Если обновление падало в первую минуту после перезапуска, бот мог молчать до 30 минут.
- **Задача переживает второе падение.** Падение сразу после «Продолжаю её» больше не теряет задачу.
- **Большие картинки приходят с ответом.** Картинка больше 10 МБ приходит файлом внутри ответа.
- **Понятные ошибки.** Потерянный вход больше не называется исчерпанным лимитом, а сырых технических ошибок в чате нет.

## 0.6.2

- **Answers survive a network blip.** A finished answer that meets a moment without a network or a Telegram limit is tried again instead of being lost.
- **The server no longer dies over small failures.** A full disk or one failed Telegram call used to bring it down, along with /cleanup.
- **/stop and /new always hold.** /stop works in the first seconds of a task, and /new is no longer undone by the task under way or by a restart.
- **No double work on one conversation.** A message sent while a computer is offline or while a task is coming back after a restart can no longer start a second task at once.
- **⚡ and restarts remember who spoke.** A message you hand in counts as your own words for decisions, and a topic's read-only limit still holds after a restart.
- **A double tap in a survey answers once.** A second tap on a slow phone no longer answers the next question.
- **Less clutter after a restart.** Stale status messages, 👀 marks, ❓ icons and leftover lines in /now go away.
- **Backups restore workspaces.** Decisions and night mode come back with their group, along with the language and open surveys.

### Русский

- **Ответы переживают сбой сети.** Готовый ответ, попавший на обрыв сети или лимит Telegram, отправляется повторно, а не теряется.
- **Сервер не падает от мелких сбоев.** Раньше полный диск или один неудачный запрос к Telegram роняли его вместе с /cleanup.
- **/stop и /new срабатывают всегда.** /stop работает в первые секунды задачи, а /new больше не отменяется идущей задачей или рестартом.
- **Нет двух задач в одном разговоре.** Сообщение, отправленное пока компьютер не в сети или задача возвращается после рестарта, больше не запускает вторую задачу параллельно.
- **⚡ и рестарт помнят, кто говорил.** Сообщение с ⚡ считается твоими словами для решений, а лимит read-only топика действует и после рестарта.
- **Двойной тап в опросе отвечает один раз.** Второй тап на медленном телефоне больше не отвечает на следующий вопрос.
- **Меньше мусора после рестарта.** Убираются устаревшие статусы, метки 👀, иконки ❓ и лишние строки в /now.
- **Бэкап восстанавливает воркспейсы.** Решения и ночной режим возвращаются вместе с группой, а также язык и открытые опросы.

## 0.6.1

- **/now in a group.** A group now sees only its own topics; the full list appears only in your private chat with the bot.
- **Cards show what runs.** A masked secret can no longer hide a command on a permission card, and a card with anything masked says so.
- **Connecting an MCP server.** An exact version now means exact: `@1` no longer counts, and ways round it are refused. Variables that change what runs show their values on the card.
- **Secrets in addresses.** Reading a page or downloading a picture asks first when the address holds a token or a long encoded run in its path or name.
- **Writes into .git.** Where files change without a question, a write into `.git` or `.husky` now asks: a hook runs with nothing on any card.
- **Programs on Windows.** A bare program name now comes from PATH only, so a `git.exe` in a project can't run in place of git. A program in the project needs its path.
- **/usage in groups.** While others read a group, it works only in your private chat with the bot.
- **A safer update helper.** The helper that runs as root on the VPS no longer writes through links left in its shared folder.

### Русский

- **/now в группе.** Группа теперь видит только свои топики, а полный список показывается только в твоей личке с ботом.
- **Карточки показывают, что выполнится.** Скрытый секрет больше не может спрятать команду в карточке разрешения, а карточка со скрытым текстом предупреждает об этом.
- **Подключение MCP-сервера.** Точная версия теперь значит точная: `@1` больше не подходит, обходные пути отклоняются. Переменные, которые меняют то, что запускается, видны на карточке вместе со значениями.
- **Секреты в адресах.** Чтение страницы и скачивание картинки сначала спрашивают, если в пути или имени адреса есть токен или длинная закодированная строка.
- **Запись в .git.** Там, где файлы меняются без вопросов, запись в `.git` или `.husky` теперь спрашивает: хук запускается, и ни одна карточка этого не показывает.
- **Программы на Windows.** Программа без пути теперь берётся только из PATH, поэтому `git.exe` в проекте не запустится вместо git. Для программы из проекта нужно указать путь.
- **/usage в группах.** Пока группу читают другие, команда работает только в твоей личке с ботом.
- **Безопаснее помощник обновлений.** Помощник, который работает на VPS от root, больше не пишет через ссылки, оставленные в его общей папке.

## 0.6.0

- **Long tasks survive a restart.** A server restart no longer ends a task. Commands on computers keep running, and the task continues by itself in the same conversation, as a reply to your message.
- **Commands survive a lost connection.** The computer finishes the command and keeps the result. It is delivered once the connection is back, and nothing runs twice.
- **Updates wait 3 minutes at most.** Tasks that don't finish in time continue after the restart. Computers restart only after their commands finish, within 3 hours.
- **Message past the queue.** Put ⚡ on a message waiting with 👀 and Claude gets it after the current step, pictures included; 🫡 says it arrived. If the task ends first, it is simply the next task.
- **Overview card.** `/now` shows what is running and what waits for your decision, by workspace, with links straight to the topic and the waiting message. Topics of the private chat show the name only, since Telegram has no links for them.
- **Workspace decisions.** What you decide in one topic of a group, every topic there now knows. `/decisions` shows the list and removes entries.
- **Night mode.** `/night` keeps agents in their own branch until you turn it off. Merges, pushes and publishing are refused in any permission mode, and each final answer says what is waiting for you.

### Русский

- **Долгие задачи переживают перезапуск.** Перезапуск сервера больше не обрывает задачу. Команды на компьютерах продолжают идти, а задача сама продолжается в том же разговоре, ответом на твоё сообщение.
- **Команды переживают обрыв связи.** Компьютер доводит команду до конца и хранит результат. Он приходит, когда связь вернётся, и ничего не запускается дважды.
- **Обновление ждёт максимум 3 минуты.** Задачи, которые не успели закончиться, продолжатся после перезапуска. Компьютеры перезапускаются, только когда закончат команды, в пределах 3 часов.
- **Сообщение вне очереди.** Поставь ⚡ на сообщение с 👀, и Claude получит его после текущего шага, вместе с картинками; 🫡 скажет, что дошло. Если задача закончится раньше, оно станет следующей задачей.
- **Обзорная карточка.** `/now` показывает, что идёт и что ждёт твоего решения, по воркспейсам, со ссылками прямо на топик и на ждущее сообщение. Топики лички показаны только по имени: у Telegram нет ссылок на них.
- **Решения воркспейса.** Что ты решил в одном топике группы, теперь знают все её топики. `/decisions` показывает список и убирает записи.
- **Ночной режим.** `/night` держит агентов в их ветках, пока ты его не выключишь. Слияния, пуши и публикации отклоняются при любых разрешениях, а в итоговом ответе агент пишет, что тебя ждёт.

## 0.5.4

- **Updates no longer hold everything.** The card that waits for tasks now has two buttons: update now, or cancel. Updating now asks first, then stops the tasks, and they continue by themselves after the restart.
- **No double reports.** An agent can't send its head a letter on top of its report, so the head isn't woken twice for the same text.

### Русский

- **Обновление больше не держит всё.** На карточке ожидания задач теперь две кнопки: обновить сейчас или отменить. «Обновить сейчас» сначала спрашивает, потом обрывает задачи, и они сами продолжаются после перезапуска.
- **Без двойных отчётов.** Агент больше не может отправить хеду письмо вдобавок к отчёту, поэтому хед не просыпается дважды из-за одного текста.

## 0.5.3

- **Service icons.** While Claude works in Figma, After Effects, Blender, Chrome or GitHub, the status line shows that service's icon and name. Computers in texts show the Windows or Apple logo.
- **Clearer cards.** The new-version card is split into what's new and how it updates. /profile and /profiles lost the doubled dots and italics, and the command for a new profile is a block you can copy.
- **Release notes in your language.** The new-version card shows them in the language of the bot.
- **Survey pictures stay.** Ticking a box no longer removes the picture of the question.
- **No silent topics in a busy group.** When Telegram's limit leaves no room for a live status, your message shows 👀 until the answer.

### Русский

- **Иконки сервисов.** Пока Claude работает в Figma, After Effects, Blender, Chrome или GitHub, в статусе видны иконка и название сервиса. Компьютеры в текстах теперь с логотипом Windows или Apple.
- **Понятнее карточки.** Карточка новой версии разбита на части: что нового и как пройдёт обновление. В /profile и /profiles убраны двойные точки и курсив, а команда для нового профиля стоит отдельным блоком, её легко скопировать.
- **Заметки на твоём языке.** Карточка новой версии показывает их на языке бота.
- **Картинка в опросе остаётся.** Галочка в вопросе больше не убирает его картинку.
- **Без тишины в загруженной группе.** Когда лимит Telegram не оставляет места для статуса, на твоём сообщении стоит 👀 до ответа.

## 0.5.2

- **A long transcript folds,** like an agent's report: an arrow opens it.
- **Every answer replies to what it answers:** a report from an agent, a message from another topic, a finished survey, and a voice message through its transcript, so the three read as one thread.
- **A report that waits for a busy head shows 👀,** like a message of yours does, until it is answered.
- **Agents put pictures in their reports,** so you see them under the report.

## 0.5.1

- **A long command is no longer stopped as "no connection to Anthropic".** When Claude ran a quick tool and a long one together, the wait for the long one counted as a dead network, and it was stopped after 3 minutes.
- **An update lists what it waits for by workspace:** topics under their workspace in bold.

## 0.5.0

- **Surveys: Claude can ask you many questions in one go.** When you ask it to, or when a decision is yours and you haven't settled it. One message walks through the questions with a count, Back, Skip and Finish. An option or several, or your own words, typed or by voice. A picture can come with a question. Leave and come back whenever, an update doesn't lose it; /stop ends it, and Claude gets what you answered, all at once.
- **A star marks what Claude advises,** on its ordinary questions too. The only blue button left is "Done".

## 0.4.14

- **Claude taps through the iOS simulator more reliably:** with a pause after each tap, since in the first real test taps without one were lost while reporting success.
- **A refusal says whose read-only mode it is:** when the limit comes from the topic that wrote here, Claude no longer sends you to /mode in the wrong topic.
- **Removing an agent says what became of its branch:** its folder is deleted and the branch stays, or the folder stays and why.
- **After /computer Claude knows the files came along:** it hears that the folder was copied, cloned or made empty, rather than guessing that the files stayed behind.
- **A computer's card in /devices shows its version,** and its rename button fits on the phone.

## 0.4.13

- **The server's disk no longer fills up with old builds:** after a good update the build cache is cut down to 5 GB. It had reached 46 GB here.

## 0.4.12

- **The browser goes by its current name,** and Claude no longer stumbles on its first step in Chrome.
- **Older computers pull in their MCP servers too:** an agent whose settings predate the option skipped them, so a server listed only in Claude Code never reached the bot.
- **A message to a topic no longer stops at an agent working in the same project:** an agent's topic goes by the agent's name.

## 0.4.11

- **The project works without Claude Code on your computers.** The MCP servers a computer has now go into the agent's own `agent.mcp.json` once, and it runs from that list. Memory and global instructions are copied once to `~/.tg-claude-vps`, and read from there. Originals are left alone.
- **Claude can connect an MCP server by itself, with your yes.** A card shows the computer, the exact command and the names of its variables, and it asks in every mode, even "Everything without asking". A package needs an exact version. Removing one works the same way.
- **On a Mac, Claude offers XcodeBuildMCP** when a task needs tapping through an iOS simulator: only the simulator, never a real iPhone.

## 0.4.10

- **The agent on a computer has its own list of MCP servers,** `agent.mcp.json` next to its config, so a server can be connected without going through Claude Code on that computer.
- **An update says what it is waiting for:** the topics still working, each with its workspace.

## 0.4.9

- **A notice that something waits now replies to the message it means:** the server updating, the limit of tasks at once, a computer that is offline, "Queued" under a message from another topic or the head.
- **A message to a topic no longer misses because of its name:** a topic is found by its project or number too, and Claude knows that the name it sees may not be the one you use. Naming a topic what it is already called now teaches the bot that name.
- **A group that becomes a workspace gets a picture of its own,** unless it has one already. The "Add a group" link now also asks for the right to change the group's info; without that right everything else works and the picture is skipped.
- **Branches keep to one folder:** worktrees go in `<project>-wt/<name>` next to the repository, as `mfm-wt` does, or in the `-wt` folder it has already. Claude follows this as a rule, and so do agents started with a branch of their own. Worktrees in such a folder appear under their repository in the picker, in pages, and the folder itself is no longer offered as a project.
- **The project picker shows a repository once:** its git worktrees sit behind one button, such as "acme-core · 2 branches", and each is still chosen from there.

## 0.4.8

- **Topics of one chat can write to each other,** so you no longer carry messages between them by hand. It shows in the receiving topic and starts that session by itself. A turn answering another topic runs under the stricter of their two modes, and 10 messages in a row without you stop until your next word.
- **A deleted message takes its request back.** Deleted before Claude starts, nothing happens. Deleted while it works, it stops within seconds and doesn't answer, and says so if something had already been done on the computer.

## 0.4.7

- Claude can really start a closed Chrome now: the tool from 0.4.4 always answered that the computer was offline.
- A topic made with `/topic` and no name now gets its name from the first task, like any other.

## 0.4.6

- **Keep talking while the computer is off.** Claude answers as usual, without its files and commands, and puts off work that needs the computer. Once it has been online for a moment, that work starts by itself, with a button to call it off. Throw in ideas on the road, turn the computer on, and it begins.
- **`/devices` is a list of computers, with a card for the one you tap:** folders, rename and unlink are there, instead of every action of every computer in one long stack.

## 0.4.5

- **Voice messages no longer end in made-up credits** such as "thanks for the subtitles to …": the speech model writes these over the silence at the end of a recording.
- **Claude waits for Chrome that has just restarted,** for example after turning on the proxy, and doesn't call the computer offline when only the extension hasn't connected yet.
- **A sleeping laptop comes back by itself:** a computer that fell asleep in the middle of connecting could stay offline after it woke, until the agent was restarted. A connection that doesn't answer is now given up on and tried again, and a refusal from the server is retried every 10 minutes rather than never.
- After moving a topic to a workspace, the old one offers to go at one tap, or stays to read.
- **Messages wait through an update:** sent while the server updates or restarts, they stay in the queue and go by themselves once it's back, instead of having to be sent again. If the update fails, they go right away.
- **Rename a computer:** `/devices` has a button for it, and the new name shows everywhere. Topics stay bound to it.

## 0.4.4

- **The command menu lists everything again:** typing a command relies on its suggestions. A group's menu has all that work there.
- **Claude starts a closed Chrome by itself** when you gave it the browser, instead of asking you to open it. It opens no page and takes a running Chrome as it is.
- **Claude can offer to delete topics:** ask "delete all topics" and it shows the list with a button; only your tap deletes. Projects and files stay.
- Claude knows the bot's commands and points to the right one instead of guessing.
- `/usage` and `/proxy` work in groups again.
- `/status` in General or an older topic of a workspace shows the workspace's settings from the start, not "not chosen".
- `/status` and `/diag` tables no longer begin with an empty row.

## 0.4.3

- **A shorter command menu:** what you use all the time; the rest work as before and are listed in `/help`.
- Stop now reaches a file Claude is copying between computers. A moved topic keeps its name. In a group with others, a file named in an answer isn't attached without the question `send_file` asks.
- An image quoted as code in an answer or an agent's report is no longer fetched, and a report no longer ends in "could not attach" for a web address it only mentions.
- **Long jobs no longer freeze the whole bot.** Copying a project, moving one from the cloud and compacting a history used to hold up every topic and account until they finished, `/stop` and permission buttons included. Now they run on the side, and a group waiting out Telegram's limit doesn't delay the private chat.
- **Harder to fool through what Claude reads:** only the bot's own code can add a button, anywhere in a message. A permission prompt no longer hides a command behind masking (`API_KEY=$(curl …|sh)`) or past its visible end: a long one says so and comes whole in a file.
- **Harder to leak through:** outside "Everything without asking", fetching an address with parameters asks first and an image at such an address isn't downloaded. More secrets are masked: quoted passwords, `DB_PASS`, `SIGNING_KEY`, GitLab, npm and Hugging Face tokens, Basic auth, and a private key still being written. The bot's own state files are off limits to file tools.
- **Groups:** commands and buttons with pairing codes, sign-ins and accounts work only in private. A file goes to a group with others only after a question. An agent on another computer or project asks first, except between your own computers in "Everything without asking". Removing an account also makes the bot leave the groups it added.
- **Pairing:** someone guessing codes on the internet can no longer lock you out of connecting a computer.
- **Removing the bot from a group stops what runs there:** its tasks and schedules used to go on working on the computers with nowhere to report.
- In a group, "Show for a minute" checks again at the tap, commands for other bots get no answer, and the command menu leaves out what only works in private.
- **Claude copies files between computers:** a file or folder, either way, up to 1 GB through the server: assets to the Mac, renders back. It never replaces anything, and the topic's mode decides whether it asks.
- **Old topics move into a workspace:** `/workspace` in a topic shows a button for each group. The conversation goes over and Claude remembers it; the messages stay in the private chat, and tasks on a schedule go along. Topics with agents stay where they are.

## 0.4.2

- **`/computer` carries a topic to another computer, conversation included.** If the project's folder isn't there, choose: from git, a copy from the first computer, or an empty folder.
- **Claude offers another computer** when a task belongs there, such as Xcode on a Mac: go there, start an agent there, or stay. Nothing switches without your tap.
- **A message waiting for a closed computer** now has buttons for the ones that are online.

## 0.4.1

- A group's status shows the elapsed time, so a long step doesn't look frozen.
- Stopping a task while an app is opening says the step was interrupted, not that it never ran: the app goes on opening.
- A step that looks up tools no longer shows part of its name in bold.
- **Answers are easier to scan on a phone:** Claude now breaks anything longer than a few lines into headings and lists, because Telegram leaves almost no gap between paragraphs.
- Adding the bot to a group no longer ends with "the bot has no such command" under its card.

## 0.4.0

- **Workspaces:** a group with topics becomes a place of its own for one area of work, so projects and agents stop piling up in one chat. `/workspace` in the private chat adds a group with the rights already set; the group's card picks the computer, project, permissions and model its new topics start from. Agents appear as topics in the same group. Only accounts from `/users` can give tasks there, and the bot leaves a group anyone else added it to.
- In a group, answers arrive whole, with a live status and a Stop button while Claude works: Telegram has no drafts there. The private chat works as before.

## 0.3.21

- **Reply buttons go away under masked answers too:** when an answer hid an email or a token, its buttons stayed after a tap and the choice came as a separate message. Now it stays in that message, and "Show for a minute" stays with it.
- **`/compact` has the same buttons as `/delete`,** and its message turns into the outcome after a tap.
- **Claude can rename its topic:** ask "rename this topic to …" and it does, in any mode.
- **Suggested replies survive a restart:** a reply button under the last answer still works after the bot restarts, for example "Updated" after an update; it used to say "no longer relevant".

## 0.3.20

- **Line breaks in answers:** lines Claude writes one under another stay that way; they used to run together into one paragraph.
- **One message for a server update:** "building the new version" turns into the outcome after the restart, instead of a second message.

## 0.3.19

- **A long conversation no longer breaks a topic.** When the history nears the model's limit, Claude compacts it before answering, which can take minutes; the bot took that silence for a lost connection, stopped it, and every retry started over. Now it shows "🗜 Compacting the conversation history…" and waits.
- **`/compact`:** how full the topic's history is (for example 965k of 1M tokens) and a "🗜 Compact" button; nothing is compacted without the tap. Past 70% the bot offers it by itself after an answer, once per session.
- The bot waits 3 minutes instead of 1 before calling the Anthropic API unreachable: a minute was too short for long thinking and big conversations.

## 0.3.18

- Long tasks and reports between the head and its agents now really fold behind an arrow, as a quote: the previous form stayed unfolded in the apps.

## 0.3.17

- **One message per computer during an update:** “restarting…” turns into “updated” when it is back, or says what version it came back on, instead of a second message.
- **A new bot gets its picture by itself** when its first owner claims it, if it has none: one you set in BotFather stays.

## 0.3.16

- **App MCP servers no longer pile up on the computers.** What a crash or an update leaves is closed at the next start, and Roblox Studio's server runs without the launcher that used to outlive it.
- **The head's tasks and messages in an agent's topic fold behind an arrow** when they are long, and so do the agents' reports shown to the head.

## 0.3.15

- **Sign-ins to any remote MCP server work like Figma's,** not only Figma's, and go through the server by themselves. The bot warns only when they can't: no computer online, or a link you open yourself.
- **No question about how Chrome goes online when it already goes through the server.** The bot asks only if Chrome goes directly or it can't tell.
- Claude no longer asks permission to open and close its own browser tabs: only for going to a page, clicking and typing.

## 0.3.14

- **A browser Claude asked for turns itself off,** so it doesn't add to every request: after a turn that didn't use it, or after 30 minutes without use. Turned on with `/browser`, it stays on until you turn it off.

## 0.3.13

- **Claude asks for your browser itself.** When a task needs Chrome and it's off in the topic, Claude asks with buttons, and a yes does what `/browser` does; the task then carries on by itself. If no browser is connected yet, the message has a button to check again.
- **Sign-ins open in your own Chrome when it goes through the server** (`/proxy` on): a new tab where you're already signed in, instead of a separate clean window. With `/proxy` off, the separate window stays, so a sign-in still goes through the server.

## 0.3.12

- **Sign in to Figma with a button.** `/tools` offers it when Figma needs a sign-in: a window opens on your computer and goes through the server, you press Allow access, and it connects by itself. No terminal on the server.
- Fixed: about one suggested-reply button set in ten did nothing when tapped, and its answer got a needless “Show for a minute” button: the masking of secrets took the button's number for a card number.

## 0.3.11

- Suggested replies under an answer with pictures now leave the message after a tap too, and the choice shows in their place.

## 0.3.10

- **Adding an account in `/users` without a keyboard that stays on screen:** tap “Add” and write to the bot from that account within 10 minutes, and the bot asks you. An ID or a forwarded message still work. The “pick from contacts” button is gone: Telegram only offers it on that keyboard.
- **The topic icon now shows only when you're needed:** ❓ waiting for you, ❗ failed. A normal answer leaves no icon and no bubble: each change of icon shows a bubble for about a second, and Telegram has no way around it.

## 0.3.9

- **See how each topic stands from the list of topics:** its icon shows ⚡ working, ❓ waiting for you, 🏁 done, ❗ failed. The bubbles Telegram leaves for a new icon or name are removed.
- Fixed: after picking an account in `/users`, the keyboard could come back, and its “Cancel” went to Claude as a message.

## 0.3.8

- **More than one Telegram account.** `/users` in the main account lists who the bot answers: add one from your contacts, by its numeric ID or by a forwarded message, and remove one. An added account has access from its first message, with its own topics and sessions, and full access to your computers and Claude limits. News of the server now goes to the main account only.
- In a permission request, the file now stands on its own line instead of trailing after the project's name.

## 0.3.7

- **Permission requests and `/delete` have their buttons inside the message too:** green to allow, red to deny or delete. After the tap they go, and the decision shows in their place. A long request, one with hidden data, or one Telegram refuses still comes with the usual buttons.

## 0.3.6

- **More of what Telegram offers, where it helps.** Times of scheduled tasks and limit resets show in your own time zone. Tags you can tap to find them all: #расписание, #ошибка, #обновление, #лимит. A long error is folded, the version in the update message links to its notes, and the key number in a limit warning is highlighted.
- **Claude's questions and the confirmation of a scheduled task have their buttons inside the message:** after an answer they go, and the choice shows in their place, a typed answer included. If Telegram refuses them, the usual buttons come instead.
- **Claude sees more of what happens in a video.** Frames are now taken where the picture changes: 3 for a still video, up to 12 for a busy one, instead of 6 evenly spaced.

## 0.3.5

- **Security fix:** a malformed address such as `/install/%FF/windows` could crash the server, without any sign-in. Update soon.
- The confirmation of a scheduled task showed only the first 1500 characters of what would run: now it shows all of it.
- A corrected message reached Claude cut at 2000 characters: now it arrives whole.
- With two owners: a 👎 could start a redo in the other's chat, and `/schedule` showed and changed the other's tasks. Each now stays in its own chat.

## 0.3.4

- **Suggested replies tidy up after themselves.** After a tap the buttons leave the message and your choice shows in their place, with no separate message; if you write something else instead, the buttons just go. An answer with pictures or hidden data keeps the old way: a separate message.

## 0.3.3

- **Voice messages are transcribed about twice as fast.** Speech is now heard in the bot's language instead of detecting it each time: 13 s instead of 25 s for a short message on a 6-core server. A message in another language comes out worse; `VOICE_LANGUAGE=auto` brings detection back.
- **Animated emoji everywhere in the bot's texts and Claude's answers,** from the RestrictedEmoji pack: about 1000 of them, used automatically. A few it doesn't have get a close one instead, like ❗ for ⚠️ and 💚 for 🟢. Code stays as written, and so do button labels.

## 0.3.2

- **Fix a message after sending it.** Edit a message that's still waiting and Claude gets the new text; if Claude has already taken it up, it hears about the correction.
- **Reactions only where they say something:** 👀 on a message waiting its turn, instead of a separate "Queued" message, and gone once it's answered; 💔 on one that failed. Nothing on a normal answer. A 👎 on Claude's answer tells it that something's off, and it puts it right.
- **What a turn cost:** the steps line of an answer shows its tokens and where the 5-hour limit stands.

## 0.3.1

- Fixed: while Claude worked, the status showed a link in place of the animated Claude.
- "In 2 hours" now counts from your tap on "Create", not from Claude's offer, so reading it late doesn't make it expire.

## 0.3.0

- **Animated Claude in the bot's status.** While it works, the status shows what it's doing: thinking, reading, editing files, running a command, writing, working with agents. A finished answer ends with a flag, a successful server update with a party. The status says more, too: "Reading…" or "Editing files…" instead of "Working…".
- **Tasks on a schedule, repeating or one-time.** Tell Claude "every morning at 9 check the build" or "tomorrow at 10 remind me about the release": it proposes the task, you confirm with a button in any mode and see the exact text that will run. `/schedule` lists tasks, pauses, deletes, and sets your time zone. Repeating ones run at most once an hour, up to 20 tasks. A run goes by the topic's `/mode`; a computer that's offline or a spent limit means a skipped run and one message, and missed runs don't pile up. A topic with a live schedule isn't deleted for being quiet.

## 0.2.10

- **Reply to a message and Claude knows which one.** Reply to any message in a topic, or to a part of it you selected, with text, voice or a file: Claude gets that message along with yours, so "redo this" is enough.
- **Claude's answer is a reply to your message,** so in a busy topic it's clear what it answers. Several messages sent together get one answer, under the last of them.
- **Claude suggests what to answer.** When its answer ends with a question or an obvious next step, buttons with short replies appear in the message; a tap sends that text as your message.
- **A warning before a limit runs out.** At 80% of the 5-hour or weekly limit the bot says so once per window, with the time it resets, after Claude's answer.
- The quote with a voice message's transcript starts with 🎙 again.

## 0.2.9

- The transcript of a voice message is shown as a quote.

## 0.2.8

- **Voice messages and round videos work out of the box.** ffmpeg and whisper.cpp are now in the server image; the first voice message or round video offers to download the speech model with a button (~550 MB, once, checked against its checksum, with progress) and is transcribed as soon as it is in place. Other videos go on with their frames right away.
- The cloud is named in the bot's language again: “☁️ Облако” in Russian, “☁️ Cloud” in English.

## 0.2.7

- **Folder browser:** a folder macOS keeps closed to the agent (Documents, Desktop, other disks) now says so and where to allow it, instead of looking empty. macOS's own helper volumes (Recovery and the like) are no longer offered, and the buttons stay two to a row so a phone doesn't cut them short.

## 0.2.6

- **The project is now called tg-claude:** github.com/scottlaren/tg-claude (the old tg-claude-vps address redirects there). Folders and autostart on computers keep the old name, so installed computers carry on as they are.
- **The bot speaks English or Russian.** It starts in the language of your Telegram; `/language` switches it, the command menu included. The project itself is now English: docs, this changelog, logs, and everything the computers and install scripts print.
- **Change the working folder from the bot.** Right after pairing, the bot shows the computer's working folder and the folders where git projects were found: keep it or pick another — from the suggestions or by browsing folders right in Telegram. Later — `/devices` → "📁 Folders": replace, add another one, remove. No Terminal and no restart. Claude can't change working folders — only you can, with buttons.
- The agent starts even if a working folder has vanished from the disk: that folder is simply skipped.
- A Mac is named in the bot without ".local" at the end.

## 0.2.5

- Fixed: the install line for Mac failed right away with "NODE_VERSION: unbound variable" — the old bash on macOS tripped over the "…" right after a variable name.

## 0.2.4

- **A computer joins with one line.** `/pair` sends a line for Windows (PowerShell) and for Mac (Terminal): it installs Node and the agent by itself, pairs the computer with the bot and turns on autostart. No git, npm or admin rights needed.
- **Such computers update from your server**, not from GitHub: the repository can stay private, and the computers need no tokens.
- **Signing in to Claude doesn't reveal your address:** the "🖥 Open sign-in on PC" button opens the sign-in page on the computer in a separate browser window that goes through the server. The browser is picked in this order: Chrome → Firefox → Edge (present on every Windows) → Brave → Yandex Browser; the default browser doesn't matter. Safari can't be used: it has no proxy of its own, only the whole Mac's proxy; your main browser and its sign-ins are left untouched. The link stays as text as a last resort, rather than a button that opens the default browser.
- **First-setup order:** the bot recommends connecting a computer first, then signing in to Claude (you can also tap "Sign in anyway"), and once the computer connects it suggests the next step by itself.

## 0.2.3

- **Claude's sign-in and the agent's keys are off-limits to Claude** in any project: the file tools don't read `.credentials.json` and `agent.config*.json`, just as they already didn't read `.env` and SSH keys.

## 0.2.2

- **The bot tells you how an update ended.** Before, "✅ Server updated" could get lost: the new server asked for the outcome before the helper had written it.
- **The new-version notice includes the list of changes.** Before, the bot sometimes showed only the version number: the description from GitHub arrived a second after the list of versions.
- **The update helper on the VPS updates itself** along with the server — fixes to it no longer require reinstalling.
- This file: the version history in one place.

## 0.2.1

- **Sign in to Claude with a button in the bot:** `/profiles` → "Sign in". The link arrives in the chat, and you send the code as your next message — the bot removes it from the chat right away and hands it only to Claude Code on the server.
- **Before sign-in, the bot checks Chrome:** if Chrome isn't going through the server, the bot offers to turn that on — then claude.ai sees the server's address, not yours.
- Fixed: the profile name in `npm run login -- --profile`; `pair` with an agent already running restarts it instead of starting a second one.

## 0.2.0

- **One-tap updates.** The bot tells you about a new version by itself (and on `/update`): "Update everything", "Remind me tomorrow", "Skip". The server moves to the new version through a helper on the VPS; if the new version doesn't come up, the previous one is brought back.
- **Computers update themselves** after the server; the ones that are off — when they connect. A developer's working copy is left untouched.
- **Private repository:** the installer asks for a read-only GitHub token; the token stays on the VPS and never gets into the containers.

## 0.1.2

- **A question before Chrome:** before Claude opens the browser, the bot asks how it should go online — through the server or directly; after a switch, it waits for Chrome to restart.
- **Chrome through the server on Mac:** the agent restarts Chrome with the proxy by itself, and the tabs come back.
- Fixes from the review (R1–R11): Chrome's proxy can't be overridden by someone else's policy; the ids of vanished folders and unpaired computers aren't handed to others; the server doesn't crash on an oversized message or a site's 205 response; IPv6 addresses are checked by what they actually are; old buttons confirm nothing after a restart.

## 0.1.1

- **Browser tunnel:** Chrome goes online through the server — sites see the server's address, not yours.
- **Your regular Chrome, with all its sign-ins, through the server:** `/proxy` in the bot (Windows).

## 0.1.0

First version: a Telegram bot, Claude on the server, agents on the computers, a cloud for code, GitHub, topics with auto-cleanup, a head and its agents, a server sandbox.
