// public/js/auth.js
(() => {
  const $  = (s) => document.querySelector(s);

  // -------- 新規登録 --------
  $("#registerForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = $("#regUsername")?.value?.trim();
    const email    = $("#regEmail")?.value?.trim() || "";
    const password = $("#regPassword")?.value || "";
    if (!username || !password) return alert("ユーザー名とパスワードを入力してください");

    try {
      const r = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "登録に失敗しました");
      alert(`登録OK: userId=${data.userId}`);
      if (typeof closeModal === "function") closeModal("registerModal");
    } catch (err) {
      console.error(err);
      alert("登録エラー: " + err.message);
    }
  });

  // -------- ログイン --------
  $("#loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = $("#loginUsername")?.value?.trim();
    const password = $("#loginPassword")?.value || "";
    if (!username || !password) return alert("ユーザー名とパスワードを入力してください");

    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "ログインに失敗しました");

      // トークン保存（簡易）
      localStorage.setItem("token", data.token);
      alert(`ログインOK: ${data.user?.username || username}`);

      if (typeof closeModal   === "function") closeModal("loginModal");
      if (typeof updateAuthUI === "function") updateAuthUI();
      if (typeof loadProducts === "function") loadProducts();

    } catch (err) {
      console.error(err);
      alert("ログインエラー: " + err.message);
    }
  });
})();
