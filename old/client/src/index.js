function el(id) {
  return document.getElementById(id);
}
function print(e) {
  console.log(e);
}

function randint(min, max) {
  return Math.floor(Math.random() * (max + 1 - min) + min);
}

function get_random_color() {
  var h = randint(1, 360);
  var s = 100;
  var l = randint(20, 80);
  return "hsl(" + h + "," + s + "%," + l + "%)";
}

function LEVEL_TO_COLOR(niveau) {
  switch (parseInt(niveau)) {
    case 1:
      return "#fff";
      break;
    case 2:
      return "#ddc1ff";
      break;
    case 3:
      return "#99e9fa";
      break;
    case 4:
      return "#91ffc0";
      break;
    case 5:
      return "#fffaab";
      break;
    case 6:
      return "#c10000";
      break;
    case 7:
      return "#222222";
      break;
    case 8:
      return "#fff";
      break;
  }
}

var niveau1 = [];
var niveau2 = [];
var niveau3 = [];
var niveau4 = [];
var niveau5 = [];
var niveau6 = [];
var niveau7 = [];
var niveau8 = [];
var niveau9 = [];

// get data and import them
for (i = 1; i < 10; i++) {
  window["niveau" + i] = [];

  $.ajax({
    type: "GET",
    url: "/data/current/data" + i + ".txt",
    async: false,
    success: function (data) {
      const array = data.split("\n");

      for (j = 0; j < array.length; j++) {
        window["niveau" + i][j] = array[j].split("@");
      }
    },
  });
  if (window["niveau" + i] == "") window["niveau" + i] = [];
}

var niveau = 1; // current level
var jour = 0;
var step = 0;
var lastplayed = 0;
var gave_up_already = false;

var audio = new Audio();

$.ajax({
  type: "GET",
  url: "/jour.txt",
  async: false,
  success: function (data) {
    jour = data.split("@")[1];
    step = data.split("@")[2];
    lastplayed = data.split("@")[0]; //get the date the last time the app was played (its the number of days from 1/1/2022)
    console.log(data);
  },
});

var choix = 0;

//
// @return {number} la date d'aujourdhui à partir du premier janvier 2026
//
function getIntFromToday() {
  let currentDay = new Date();
  let reference = new Date(2026, 0, 1);
  currentDay = Math.round((currentDay - reference) / (1000 * 60 * 60 * 24));
  return currentDay;
}

// return current level, also move up the day
// Le niveau/step devrait passer au suivant automatiquement si on a fait 20 (ou 50?) mot dans le step actuel
function choixniveau() {
  if (choix != 0) return choix;
  let motchoisi = false;
  while (motchoisi == false) {
    if (step < yaquoi(jour).length && window["niveau" + yaquoi(jour)[step]][0] != null) {
      //SI LE NIVEAU A DES MOTS
      motchoisi = true;
    }
    else {
      if (step + 1 < yaquoi(jour).length) {
        //SI IL RESTE DES STEPS A FAIRE
        // AKA SI IL RESTE DES MOTS A FAIRE
        step = parseInt(step) + 1;
      }
      else {
        step = 0;
        jour = parseInt(jour) + 1;
        lastplayed = getIntFromToday();
      }
    }
  }

  $.ajax({
    type: "POST",
    url: "/overwrite2",
    data: { lastplayed: getIntFromToday(), jour: jour, step: step },
  });

  return yaquoi(jour)[step];

  // return array containing what levels to do today
  // input current day
  function yaquoi(n) {
    let tableur = [];
    if (n % 64 == 0) tableur.push(8);
    if (n % 64 == 32) tableur.push(7);
    if (n % 32 == 16) tableur.push(6);
    if (n % 16 == 8) tableur.push(5);
    if (n % 8 == 4) tableur.push(4);
    if (n % 4 == 2) tableur.push(3);
    if (n % 2 == 1) tableur.push(2);
    tableur.push(1);
    return tableur;
  }
}

var state = 2;
//state 1 waiting for an input/answer
//state 2 waiting for new question to appear

var questionType = "writing";

function newword() {
  //newword est la  première fonction lancée, selon l'état du site, il va demander un mot ou donner la réponse

  // dessine les histogrammes
  for (let i = 1; i < 10; i++) {
    el("carre" + i).style.height = Math.floor(Math.log(window["niveau" + i].length + 1)) * 4 + Math.floor(window["niveau" + i].length / 50) + "px";
    el("nbmots_carre" + i).innerHTML = window["niveau" + i].length;
    el("carre" + i).style.background = LEVEL_TO_COLOR(i);
    el("carre8").style.backgroundImage = "linear-gradient(#F59,#FF8,#5CF)";
    el("carre9").style.backgroundImage = "url('src/img/Mao_Zedong_portrait.jpg')";
    el("carre9").style.backgroundSize = "contain";
  }

  if (state == 1) {
    playVoice();
    //Donner la réponse
    state = 2;
    el("cnword").innerText = array2[random][0];
    el("enword").innerText = array2[random][1];
    el("pinyin").innerText = array2[random][2];
    //display example
    if (array2[random].length >= 4) {
      el("div_example").innerText = array2[random][3];
      if (array2[random][3].length > 26) {
        el("div_example").style.fontSize = "20px";
      } else if (array2[random][3].length > 13) {
        el("div_example").style.fontSize = "25px";
      } else {
        el("div_example").style.fontSize = "30px";
      }
    }
  } else if (state == 2) {
    //Donner la question
    state = 1;
    niveau = choixniveau();
    array2 = window["niveau" + niveau];
    el("pinyin").innerHTML = "";
    el("cnword").innerHTML = "";
    el("enword").innerHTML = "";
    random = randint(0, array2.length - 1);
    gave_up_already = false; //permet de give up les mots qu'on a déjà skip
    el("level").innerHTML = niveau;
    el("day").innerHTML = jour;
    el("Nbwords").innerHTML =
      niveau1.length +
      niveau2.length +
      niveau3.length +
      niveau4.length +
      niveau5.length +
      niveau6.length +
      niveau7.length +
      niveau8.length +
      niveau9.length;
    el("prompt").style.background = LEVEL_TO_COLOR(niveau);
    if (niveau == 8) el("prompt").style.backgroundImage = "linear-gradient(#F59,#FF8,#5CF)";
    if (niveau == 9) el("prompt").style.backgroundImage = "url('src/img/Mao_Zedong_portrait.jpg')";
    if (niveau == 6 || niveau == 7) el("prompt").style.color = "white";
    else el("prompt").style.color = "black";

    let learn_writing = array2[random][0][0] == "." ? 1 : 0;

    //listening         : get eng    from pinyin
    //reading           : get pinyin from cn
    //comprehension     : get eng    from cn
    //writing           : get cn     from eng

    // ENGLISH
    // PINYIN
    // CN CHARS

    const LEVEL_TO_QUESTION_TYPE = {
      1: "writing",
      2: "reading",
      3: "comprehension",
      4: "reading",
      5: "comprehension",
      6: "writing",
      7: "comprehension",
      8: "reading",
      9: "writing",
    };

    questionType = LEVEL_TO_QUESTION_TYPE[niveau];

    if (questionType == "writing") { // write cn word (if not learn_writing, hide pinyin)
      el("questionType").innerHTML = "chinese";
      el("enword").innerText = array2[random][1];
      if (niveau <= 3) playVoice();
      if (learn_writing && niveau < 5) el("pinyin").innerText = array2[random][2];
    }
    else if (questionType == "reading") { // write pinyin from the chinese char
      el("questionType").innerHTML = "pinyin";
      el("cnword").innerText = array2[random][0];
      if (niveau <= 5) {
        el("enword").innerText = array2[random][1];
        playVoice();
      }
    }
    else if (questionType == "comprehension") { // write english
      el("questionType").innerHTML = "english";
      el("cnword").innerText = array2[random][0];
      if (niveau <= 5) {
        el("pinyin").innerText = array2[random][2];
        playVoice();
      }
    }
    else if (questionType == "listening") { // write english, not used
      el("questionType").innerHTML = "english";
      el("pinyin").innerText = array2[random][2];
      playVoice();
    }
    else if (questionType == "speaking") { // write pinyin, not used
      el("questionType").innerHTML = "write pinyin";
      el("enword").innerText = array2[random][1];
    }

    if (learn_writing) {
      el("oral_only").style.display = "none";
      el("write_only").style.display = "block";
    } else {
      el("oral_only").style.display = "block";
      el("write_only").style.display = "none";
    }
    if (array2[random][0].length > 10) el("cnword").style.fontSize = "40px";
    else if (array2[random][0].length > 6) el("cnword").style.fontSize = "50px";
    else if (array2[random][0].length > 4) el("cnword").style.fontSize = "55px";
    else el("cnword").style.fontSize = "60px";

    if (array2[random][1].length > 50) el("enword").style.fontSize = "16px";
    else if (array2[random][1].length > 26) el("enword").style.fontSize = "20px";
    else if (array2[random][1].length > 13) el("enword").style.fontSize = "30px";
    else el("enword").style.fontSize = "40px";

    el("div_example").innerText = "";
  }
}

function success() {
  let destination = Math.min(9, parseInt(niveau) + 1);
  //you can't push into "" so i first check if it's ""
  DB_updateWord(array2[random][0], niveau, destination);
  if (window["niveau" + destination] === "")
    window["niveau" + destination] = [array2[random]];
  else
    window["niveau" + destination].push(array2[random]);
  window["niveau" + niveau].splice(random, 1);
  el("pass").value = "";
  el("result").innerHTML = "";
}

function giveup() {
  function move_word_to_lvl1() {
    if (niveau1 === "") {
      niveau1 = [array2[random]];
    } else {
      niveau1.push(array2[random]);
    }
    window["niveau" + niveau].splice(random, 1);
    DB_updateWord(array2[random][0], niveau, 1)
  }
  if (state == 1) {
    newword();
    move_word_to_lvl1();
    gave_up_already = true;
  }
  else if (state == 2) {
    if (gave_up_already == false)
      move_word_to_lvl1();
    newword();
  }
}

// should probably return a promise or block to return the success
function DB_updateWord(cn_word, old_level, new_level) {
  $.ajax({
    type: "POST",
    url: "/update_word",
    data: { cn_word: cn_word, old_level: old_level, new_level: new_level },
    success: function () {
      document.body.style.backgroundColor = get_random_color();
    },
    error: function (xhr) {
      el("enword").innerHTML = "<span style='color:red'>" + xhr.responseText + "</span>"
    },
  });
}

// update the data of level e in the database
// @param e integer (the level which to update)
//
function updateData(e) {
  //bouge au niveau supérieur maybe
  array2 = window["niveau" + e];
  print("updated level " + e);
  data = [];
  array = [];
  for (i = 0; i < array2.length; i++)
    array[i] = array2[i].join("@");
  if (array[0] == "")
    array.splice(0, 1);
  data = array.join("\n");

  $.ajax({
    type: "POST",
    url: "/overwrite",
    data: { niveau: "current/data" + e, data: data },
    success: function () {
      document.body.style.backgroundColor = get_random_color();
    },
    error: function (xhr) {
      el("enword").innerHTML = "<span style='color:red'>" + xhr.responseText + "</span>"
    },
  });
}

function compare() {
  var mdp = document.getElementById("pass").value;

  if (mdp.startsWith("?") || mdp.startsWith("？")) {
    var element = document.getElementById("result");
    // before i allowed to run any code.
    // now, only doing ?熟悉 will find if that word is somewhere or not
    // var command = mdp.slice(1).replaceAll(/“/g, '"').replaceAll(/”/g, '"');
    // command = command.replaceAll(/«/g, '"').replaceAll(/»/g, '"');
    // command = command.replaceAll(/（/g, '(').replaceAll(/）/g, ')');
    // element.innerHTML = eval(command).replaceAll(/\n/g, '<br>');
    if (mdp.length == 1) {
      el("result").innerHTML = "";
      return;
    }
    let search_result = isExist(mdp.slice(1))
    element.innerHTML = search_result.replaceAll(/\n/g, '<br>');
  } else {
    if (state == 1) {
      if (questionType == "comprehension" || questionType == "listening") {
        if (mdp.length == 0) {
          newword();
        } else if (mdp.length > 1) {
          if (array2[random][1].toLowerCase().includes(mdp.toLowerCase())) {
            //IF YOU SUCCEEDED!!!
            newword();
            success();
          } else {
            var element = document.getElementById("result");
            element.appendChild(document.createTextNode("X"));
          }
        }
      } else if (questionType == "writing") {
        if (mdp.length == 0) {
          newword();
        } else if (array2[random][0].includes(mdp)) {
          newword();
          success();
        } else {
          var element = document.getElementById("result");
          element.appendChild(document.createTextNode("X"));
        }
      } else if (questionType == "reading" || questionType == "speaking") {
        if (mdp.length == 0) {
          newword();
        } else if (pinyin_compare(mdp, array2[random][2])) {
          newword();
          success();
        } else {
          var element = document.getElementById("result");
          element.appendChild(document.createTextNode("X"));
        }
      }
    } else if (state == 2) {
      newword();
    }
  }
}

function pinyin_compare(guess, solution) {
  guess = guess.replaceAll("â", "ǎ");
  guess = guess.replaceAll("î", "ǐ");
  guess = guess.replaceAll("ô", "ǒ");
  guess = guess.replaceAll("û", "ǔ");
  if (el("fuzzy_pinyin").checked == true) {
    solution = solution
      .replaceAll("á", "ǎ")
      .replaceAll("é", "ě")
      .replaceAll("ǐ", "í")
      .replaceAll("ó", "ǒ")
      .replaceAll("ú", "ǔ")
      .replaceAll("ǘ", "ǚ");
    guess = guess
      .replaceAll("á", "ǎ")
      .replaceAll("é", "ě")
      .replaceAll("ǐ", "í")
      .replaceAll("ó", "ǒ")
      .replaceAll("ú", "ǔ")
      .replaceAll("ǘ", "ǚ");
  }
  // remove whitespaces from the solution
  return solution.replace(/\s+/g, "").includes(guess);
}

function playVoice() {
  if (el("sound_mute").checked)
    return;

  var word_to_say;
  if (el("cnword").innerText)
    word_to_say = el("cnword").innerText
  else
    word_to_say = array2[random][0]

  // replace characters that shouldnt be spoken
  word_to_say = word_to_say.replaceAll("<", "").replaceAll(">", "");

  let audio = new Audio(
    "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=zh-CN&q=" + word_to_say);
  audio.play();
}

//check if a word is already in the list
function isExist(word) {
  var res = "";
  for (let i = 1; i < 10; i++) {
    for (let entry of window["niveau" + i]) {
      if ((entry[1].includes(word)) || (entry[0].includes(word))) {
        res += "exists in level " + i + ": " + entry[0] + ", " + entry[1] + ", " + entry[2];
        res += "\n";
      }
    }
  }
  if (res) return res;
  return "Couldn't find " + word;
}

// Allow the user to skip the current step
function skip_step() {
  step++;
  if (state == 1)
    newword();
  newword();
}