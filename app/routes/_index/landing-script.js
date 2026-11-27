// Askmerce landing page behaviour: theme switch, hero typing,
// "normal search vs Askmerce" demo and the merchant walkthrough.
// Runs in the browser only (called from useEffect); returns a
// stop function that ends every loop, timer and observer.

export function startLanding() {
  var alive = true;
  var stops = [];

  (function(){
    var root = document.documentElement, themeBtn = document.getElementById("themeBtn");
    function syncThemeLabel(){ themeBtn.setAttribute("aria-label", root.getAttribute("data-theme") === "dark" ? "Switch to light mode" : "Switch to dark mode"); }
    syncThemeLabel();
    themeBtn.addEventListener("click", function(){
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try{ localStorage.setItem("askmerce-theme", next); }catch(e){ /* storage blocked: theme still switches */ }
      syncThemeLabel();
    });
  })();
  (function(){
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var tint = {
      sky:["var(--sky-soft)","var(--sky)"], violet:["var(--violet-soft)","var(--violet)"],
      mint:["var(--mint-soft)","var(--mint)"], amber:["var(--amber-soft)","var(--amber)"],
      coral:["var(--coral-soft)","var(--coral)"], lime:["var(--lime-soft)","var(--lime-deep)"],
      grey:["#eef0f3","#94a3b8"]
    };
    function thumb(icon,c){
      var t = tint[c]||tint.grey;
      return '<span class="thumb" style="background:'+t[0]+';color:'+t[1]+'"><svg width="28" height="28"><use href="#i-'+icon+'"/></svg></span>';
    }
    function wait(ms){ return new Promise(function(r){ setTimeout(r, reduce ? 0 : ms); }); }

    /* ---------- reveal on scroll ---------- */
    var io = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target); } });
    },{threshold:.12});
    document.querySelectorAll(".reveal").forEach(function(el){ io.observe(el); });
    stops.push(function(){ io.disconnect(); });

    /* ---------- HERO typing loop ---------- */
    var heroData = [
      {q:"warm jacket for snowy hikes", why:"Matched warmth, outdoor use and weather", items:[["Insulated hiking anorak","$139","jacket","sky"],["Waterproof down jacket","$129","jacket","violet"],["Fleece-lined shell","$98","jacket","mint"]]},
      {q:"gift for dad who loves coffee", why:"Matched the person, the occasion and the interest", items:[["Pour-over coffee set","$42","cup","amber"],["Stoneware mug duo","$28","cup","coral"],["Gift card bundle","$50","gift","violet"]]},
      {q:"sneekers", why:"Understood the typo: sneakers", items:[["Canvas low-top sneaker","$64","shoe","sky"],["Everyday running shoe","$89","shoe","mint"],["White leather trainer","$95","shoe","amber"]]}
    ];
    var hq = document.getElementById("heroQ"), hr = document.getElementById("heroResults"), hw = document.getElementById("heroWhy");
    async function heroLoop(){
      await wait(1700);
      var i = 0;
      while(alive){
        var d = heroData[i % heroData.length];
        hr.innerHTML = d.items.map(function(it){ return '<div class="hcard">'+thumb(it[2],it[3])+'<div><b>'+it[0]+'</b><span>'+it[1]+'</span></div></div>'; }).join("");
        hw.style.opacity = 0;
        for(var k=1;k<=d.q.length;k++){ hq.textContent = d.q.slice(0,k); await wait(55 + Math.random()*60); }
        await wait(350);
        hw.innerHTML = '<svg class="spark" style="color:var(--lime-deep)"><use href="#i-spark"/></svg>'+d.why;
        hw.style.opacity = 1;
        var cards = hr.querySelectorAll(".hcard");
        for(var c=0;c<cards.length;c++){ cards[c].classList.add("show"); await wait(140); }
        await wait(2600);
        for(var c2=0;c2<cards.length;c2++) cards[c2].classList.remove("show");
        for(var b=d.q.length;b>=0;b--){ hq.textContent = d.q.slice(0,b); await wait(22); }
        i++;
      }
    }
    heroLoop();

    /* ---------- COMPARISON ---------- */
    var examples = [
      { q:"sneekers",
        normal:{empty:true, title:"No results for “sneekers”", sub:"Check the spelling or try another word."},
        ai:{why:"Understood the typo → <b>sneakers</b>", items:[["Canvas low-top sneaker","$64","shoe","sky"],["Everyday running shoe","$89","shoe","mint"],["White leather trainer","$95","shoe","amber"]]},
        bad:"0 results — the shopper leaves", good:"3 matches — added to cart" },
      { q:"couch",
        normal:{empty:true, title:"No results for “couch”", sub:"Your products are called “sofa”."},
        ai:{why:"Same meaning → <b>sofas</b>", items:[["3-seat linen sofa","$899","sofa","violet"],["Compact loveseat","$649","sofa","sky"],["Corner sofa","$1,190","sofa","mint"]]},
        bad:"0 results — even though you sell it", good:"3 matches — found what they meant" },
      { q:"warm jacket for winter hikes",
        normal:{wrong:[["Light denim jacket","$59","jacket"],["Summer windbreaker","$45","jacket"]]},
        ai:{why:"Matched <b>warm</b> + <b>outdoor</b> + <b>winter</b>", items:[["Insulated hiking anorak","$139","jacket","sky"],["Waterproof down jacket","$129","jacket","violet"],["Fleece-lined shell","$98","jacket","mint"]]},
        bad:"Wrong products — only the word “jacket” matched", good:"3 matches — right for the weather" },
      { q:"gift for dad under $50",
        normal:{empty:true, title:"No results for “gift for dad under $50”", sub:"Try fewer words."},
        ai:{why:"Matched <b>gift</b> + <b>for dad</b> + <b>under $50</b>", items:[["Pour-over coffee set","$42","cup","amber"],["Stoneware mug duo","$28","cup","coral"],["Leather wallet gift box","$45","gift","violet"]]},
        bad:"0 results — budgets aren't understood", good:"3 gifts, all under $50" }
    ];
    var pN = document.getElementById("pN"), pA = document.getElementById("pA");
    var oN = document.getElementById("oN"), oA = document.getElementById("oA");
    var hand = document.getElementById("hand");
    var chips = document.querySelectorAll(".chip");
    var shopper = document.getElementById("shopper"), avUse = document.getElementById("avUse"), shopLine = document.getElementById("shopLine");
    function setFace(face, text){
      avUse.setAttribute("href", "#i-" + face);
      shopLine.textContent = text;
      shopper.classList.remove("joy");
      if(face === "happy"){ void shopper.offsetWidth; shopper.classList.add("joy"); }
    }
    function faceIcon(face){ return '<svg width="24" height="24" aria-hidden="true"><use href="#i-'+face+'"/></svg>'; }
    var run = 0;

    function el(p,s){ return p.querySelector(s); }
    function moveHand(target, phone){
      var pr = phone.getBoundingClientRect(), tr = target.getBoundingClientRect();
      hand.style.opacity = 1;
      hand.style.transform = "translate("+(tr.left - pr.left + tr.width*0.55)+"px,"+(tr.top - pr.top + tr.height*0.35)+"px)";
    }

    async function play(idx){
      if(!alive) return;
      var id = ++run, ex = examples[idx];
      chips.forEach(function(c){ c.setAttribute("aria-pressed", String(+c.dataset.i === idx)); });
      [pN,pA].forEach(function(p){ el(p,".q").textContent=""; el(p,".results").innerHTML=""; el(p,".sfield").classList.remove("active"); });
      oN.classList.remove("show"); oA.classList.remove("show");
      hand.style.opacity = 0; hand.style.transform = "translate(260px,420px)";
      setFace("think", "Looking for something on their phone…");
      await wait(500); if(id!==run) return;

      // shopper taps the search field
      moveHand(el(pA,".sfield"), pA);
      await wait(950); if(id!==run) return;
      [pN,pA].forEach(function(p){ var t=el(p,".tap"); t.classList.remove("go"); void t.offsetWidth; t.classList.add("go"); el(p,".sfield").classList.add("active"); });
      hand.style.opacity = 0;

      // types the same words into both stores
      setFace("think", "Typing: “" + ex.q + "”");
      for(var k=1;k<=ex.q.length;k++){
        if(id!==run) return;
        el(pN,".q").textContent = el(pA,".q").textContent = ex.q.slice(0,k);
        await wait(70 + Math.random()*70);
      }
      await wait(300); if(id!==run) return;
      [pN,pA].forEach(function(p){ el(p,".results").innerHTML='<div class="skel"></div><div class="skel"></div>'; });
      await wait(700); if(id!==run) return;

      // normal search
      var rn = el(pN,".results");
      if(ex.normal.empty){
        rn.innerHTML = '<div class="empty"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8.5 9.5l5 5M13.5 9.5l-5 5"/></svg><b>'+ex.normal.title+'</b><span>'+ex.normal.sub+'</span></div>';
        setTimeout(function(){ var e=rn.querySelector(".empty"); if(e) e.classList.add("show"); }, 30);
      } else {
        rn.innerHTML = '<div class="status">2 results for “'+ex.q+'”</div>' + ex.normal.wrong.map(function(it){
          return '<div class="rcard wrong">'+thumb(it[2],"grey")+'<div class="meta"><b>'+it[0]+'</b><span>'+it[1]+'</span><br><span class="miss">Not what they meant</span></div></div>';
        }).join("");
        rn.querySelectorAll(".rcard").forEach(function(c,i){ setTimeout(function(){ c.classList.add("show"); }, 60+i*140); });
      }

      // Askmerce
      var ra = el(pA,".results");
      ra.innerHTML = '<div class="status"><svg class="spark" style="color:var(--lime-deep)"><use href="#i-spark"/></svg><span>'+ex.ai.why+'</span></div>' + ex.ai.items.map(function(it){
        return '<div class="rcard">'+thumb(it[2],it[3])+'<div class="meta"><b>'+it[0]+'</b><span>'+it[1]+'</span></div><span class="add">Add</span></div>';
      }).join("");
      var cards = ra.querySelectorAll(".rcard");
      for(var c=0;c<cards.length;c++){ cards[c].classList.add("show"); await wait(160); }
      if(id!==run) return;
      oN.innerHTML = faceIcon("sad") + ex.bad; oN.classList.add("show");

      // shopper taps "Add" on the first match
      await wait(500); if(id!==run) return;
      var add = cards[0].querySelector(".add");
      moveHand(add, pA);
      await wait(950); if(id!==run) return;
      add.classList.add("done"); add.textContent = "Added";
      hand.style.opacity = 0;
      oA.innerHTML = faceIcon("happy") + ex.good; oA.classList.add("show");
      setFace("happy", "Found it with Askmerce — and added it to the cart!");

      await wait(3200); if(id!==run) return;
      play((idx+1) % examples.length);
    }
    chips.forEach(function(c){ c.addEventListener("click", function(){ play(+c.dataset.i); }); });

    var started = false;
    var ioCompare = new IntersectionObserver(function(es){
      if(es[0].isIntersecting && !started){ started = true; play(0); }
    },{threshold:.3}).observe(document.getElementById("compare"));


    /* ---------- WALKTHROUGH PLAYER ---------- */
    var scenes = document.querySelectorAll(".scene"), chaps = document.querySelectorAll(".chap");
    var bars = document.querySelectorAll(".track b"), playBtn = document.getElementById("playBtn");
    var SCENE_MS = 6000, s = 0, t0 = 0, paused = false, elapsed = 0, raf;
    function countUp(sc){
      sc.querySelectorAll(".count").forEach(function(n){
        var to = +n.dataset.to, dur = +(n.dataset.dur || 3200), st = performance.now() + +(n.dataset.delay || 0);
        n.textContent = "0";
        (function step(now){ var p = Math.max(0, Math.min(1,(now-st)/dur)); n.textContent = Math.round(to*p); if(p<1 && sc.classList.contains("on")) requestAnimationFrame(step); })(st);
      });
    }
    function show(i){
      s = i; elapsed = 0; t0 = performance.now();
      scenes.forEach(function(sc,k){
        sc.classList.remove("on");
        if(k===i){ void sc.offsetWidth; sc.classList.add("on"); countUp(sc); }
      });
      chaps.forEach(function(c,k){ c.setAttribute("aria-current", String(k===i)); });
      bars.forEach(function(b,k){ b.style.width = k<i ? "100%" : "0"; });
    }
    function tick(now){
      if(!paused){
        elapsed = now - t0;
        bars[s].style.width = Math.min(100, elapsed/SCENE_MS*100) + "%";
        if(elapsed >= SCENE_MS) show((s+1) % scenes.length);
      }
      if(alive) raf = requestAnimationFrame(tick);
    }
    chaps.forEach(function(c){ c.addEventListener("click", function(){ show(+c.dataset.s); }); });
    playBtn.addEventListener("click", function(){
      paused = !paused;
      if(!paused) t0 = performance.now() - elapsed;
      scenes[s].querySelectorAll("*").forEach(function(n){ n.style.animationPlayState = paused ? "paused" : "running"; });
      document.getElementById("icPause").style.display = paused ? "none" : "";
      document.getElementById("icPlay").style.display = paused ? "" : "none";
      playBtn.setAttribute("aria-label", paused ? "Play walkthrough" : "Pause walkthrough");
    });
    var walkStarted = false;
    var ioWalk = new IntersectionObserver(function(es){
      if(es[0].isIntersecting && !walkStarted){ walkStarted = true; show(0); raf = requestAnimationFrame(tick); }
    },{threshold:.25}).observe(document.getElementById("walkthrough"));
    stops.push(function(){ run++; cancelAnimationFrame(raf); ioCompare.disconnect(); ioWalk.disconnect(); });
  })();

  return function stopLanding() {
    alive = false;
    stops.forEach(function (stop) { try { stop(); } catch (e) { /* already gone */ } });
  };
}
