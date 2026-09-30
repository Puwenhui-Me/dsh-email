window.__ModuleLoader__.load({ id: "@puwenhui/dsh-email", factory: (require) => {


		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region settings-tab.tsx
		/**
		* 设置 → 插件 →「邮件」标签页：邮箱连接与提醒规则表单（DSH 0.2.0 形态）。
		* 数据层：describe 拉取 namespace 视图（schema/value/user/revision），mutate 原子写
		* （落 profile patch 的 entry config，宿主自动重挂载插件）。
		* 「已覆盖」标记与恢复默认基于 user 层字段存在性；密码字段不回显，输入新值才写入。
		*/
		/** 字段清单（与宿主半边 Config schema 保持同步） */
		const FIELDS = [
			{
				key: "user",
				label: "邮箱账号",
				type: "string",
				placeholder: "name@corp.com"
			},
			{
				key: "pass",
				label: "邮箱密码",
				type: "secret",
				hint: "留空表示不修改；未设置时使用环境变量"
			},
			{
				key: "host",
				label: "IMAP 收件服务器",
				type: "string",
				placeholder: "imap.263.net"
			},
			{
				key: "port",
				label: "IMAP 端口",
				type: "number"
			},
			{
				key: "tlsMode",
				label: "加密方式",
				type: "string",
				placeholder: "tls（可选 starttls / none）"
			},
			{
				key: "smtpHost",
				label: "SMTP 发件服务器",
				type: "string",
				placeholder: "smtp.263.net"
			},
			{
				key: "smtpPort",
				label: "SMTP 端口",
				type: "number",
				hint: "263 为 25（无 SSL）；465 自动 SSL"
			},
			{
				key: "smtpUser",
				label: "SMTP 账号",
				type: "string",
				placeholder: "默认同邮箱账号"
			},
			{
				key: "smtpPass",
				label: "SMTP 密码",
				type: "secret",
				hint: "默认同邮箱密码；留空表示不修改"
			},
			{
				key: "folders",
				label: "同步文件夹",
				type: "array",
				placeholder: "INBOX, 已发送, 垃圾邮件"
			},
			{
				key: "pollSeconds",
				label: "同步间隔（秒）",
				type: "number"
			},
			{
				key: "backfillDays",
				label: "首次回填天数",
				type: "number"
			},
			{
				key: "notifyEnabled",
				label: "开启重要新邮件提醒",
				type: "boolean"
			},
			{
				key: "notifyAll",
				label: "所有新邮件都提醒",
				type: "boolean",
				hint: "慎开，容易骚扰"
			},
			{
				key: "notifyFrom",
				label: "重要发件人白名单",
				type: "array",
				placeholder: "leader@corp.com, 客户A"
			},
			{
				key: "notifyKeywords",
				label: "主题关键词",
				type: "array",
				placeholder: "审批, 紧急"
			}
		];
		function MailSettingsTab(props) {
			const face = props.face;
			const [ns, setNs] = (0, react.useState)(null);
			const [view, setView] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)(null);
			const [saving, setSaving] = (0, react.useState)(false);
			const [message, setMessage] = (0, react.useState)(null);
			const [failed, setFailed] = (0, react.useState)(false);
			const reload = (0, react.useCallback)(async () => {
				setError(null);
				if (face === void 0 || typeof face.describe !== "function") {
					setError("组件未收到设置读写面（inject face 缺失）");
					return;
				}
				const timeout = new Promise((_, reject) => setTimeout(() => reject(/* @__PURE__ */ new Error("settings.describe 8 秒未响应")), 8e3));
				let result;
				try {
					result = await Promise.race([face.describe(), timeout]);
				} catch (e) {
					setError(`读取设置失败：${String(e.message)}`);
					return;
				}
				if ("error" in result) {
					setError(result.error);
					return;
				}
				const rows = result.namespaces ?? [];
				const hit = rows.find((row) => row.ns === "email-tools") ?? rows.find((row) => row.ns === "dsh-email") ?? rows.find((row) => row.ns === "@puwenhui/dsh-email");
				if (hit === void 0) {
					setError(`设置视图中未找到邮件插件命名空间（共 ${String(rows.length)} 个：${rows.map((r) => r.ns).slice(0, 8).join(", ")}…）`);
					return;
				}
				setNs(hit.ns);
				setView(hit);
				setDraft(null);
			}, [face]);
			(0, react.useEffect)(() => {
				reload();
			}, [reload]);
			const current = view?.value ?? {};
			const userLayer = view?.user ?? {};
			const shown = draft ?? current;
			const edit = (key, value) => {
				setMessage(null);
				setFailed(false);
				setDraft((prev) => ({
					...prev ?? { ...current },
					[key]: value
				}));
			};
			const asText = (f) => {
				const v = shown[f.key];
				if (f.type === "array") return Array.isArray(v) ? v.join(", ") : String(v ?? "");
				return String(v ?? "");
			};
			const save = async () => {
				if (draft === null || ns === null || view === void 0) return;
				setSaving(true);
				try {
					const ops = [];
					for (const f of FIELDS) {
						const after = draft[f.key];
						if (after === void 0) continue;
						if (f.type === "secret" && String(after) === "") continue;
						const before = current[f.key];
						if (JSON.stringify(after) === JSON.stringify(before)) continue;
						ops.push({
							op: "set",
							path: [f.key],
							value: after
						});
					}
					if (ops.length > 0) {
						const result = await face.mutate(ns, ops, view.revision);
						if (!result.ok) throw new Error(result.error ?? "写入失败");
					}
					setDraft(null);
					setFailed(false);
					setMessage(ops.length > 0 ? "已保存，插件已按新配置自动重载" : "无更改");
					await reload();
				} catch (e) {
					setFailed(true);
					setMessage(`保存失败：${String(e.message)}`);
				} finally {
					setSaving(false);
				}
			};
			const resetField = async (f) => {
				if (ns === null || view === void 0) return;
				setSaving(true);
				try {
					const result = await face.mutate(ns, [{
						op: "unset",
						path: [f.key]
					}], view.revision);
					if (!result.ok) throw new Error(result.error ?? "写入失败");
					if (draft !== null) {
						const next = { ...draft };
						delete next[f.key];
						setDraft(next);
					}
					setMessage(`已恢复默认：${f.label}`);
					await reload();
				} catch (e) {
					setFailed(true);
					setMessage(`恢复失败：${String(e.message)}`);
				} finally {
					setSaving(false);
				}
			};
			const inputStyle = {
				width: "100%",
				padding: "6px 10px",
				font: "inherit",
				boxSizing: "border-box",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: "6px",
				background: "var(--dsw-alias-bg-layer-2)",
				color: "var(--dsw-alias-label-primary)"
			};
			if (error !== null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					...cardStyle,
					color: "var(--dsw-alias-label-tertiary)"
				},
				children: [
					"邮件配置加载失败：",
					error,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => {
							reload();
						},
						style: {
							...btnStyle,
							marginLeft: "10px"
						},
						children: "重试"
					})
				]
			});
			if (view === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					...cardStyle,
					color: "var(--dsw-alias-label-tertiary)"
				},
				children: "邮件配置加载中…"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: cardStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
					style: { fontSize: "14px" },
					children: "邮箱连接与提醒"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: "10px 14px",
						marginTop: "12px"
					},
					children: [FIELDS.map((f) => {
						const overridden = Object.hasOwn(userLayer, f.key);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "4px",
								fontSize: "13px"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: { color: "var(--dsw-alias-label-secondary)" },
									children: [
										f.label,
										overridden && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												marginLeft: "6px",
												color: "var(--dsw-alias-brand-primary)"
											},
											title: "用户已覆盖默认值",
											children: f.type === "secret" ? "·已设置" : "·已覆盖"
										}),
										overridden && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											disabled: saving,
											onClick: () => {
												resetField(f);
											},
											style: {
												marginLeft: "8px",
												padding: "0 6px",
												border: "1px solid var(--dsw-alias-border-l2)",
												borderRadius: "4px",
												background: "transparent",
												font: "inherit",
												fontSize: "11px",
												color: "var(--dsw-alias-label-secondary)",
												cursor: "pointer"
											},
											children: "恢复默认"
										})
									]
								}),
								f.type === "boolean" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: shown[f.key] === true,
									onChange: (e) => {
										edit(f.key, e.target.checked);
									},
									style: {
										width: "16px",
										height: "16px"
									}
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: f.type === "secret" ? "password" : "text",
									value: f.type === "secret" ? String(draft?.[f.key] ?? "") : asText(f),
									placeholder: f.placeholder ?? (f.type === "secret" ? "输入新值（不回显）" : ""),
									onChange: (e) => {
										const raw = e.target.value;
										if (f.type === "number") edit(f.key, raw === "" ? void 0 : Number(raw));
										else if (f.type === "array") edit(f.key, raw === "" ? [] : raw.split(/[,，]/).map((s) => s.trim()).filter((s) => s !== ""));
										else edit(f.key, raw);
									},
									style: inputStyle
								}),
								f.hint !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: "11px",
										color: "var(--dsw-alias-label-tertiary)"
									},
									children: f.hint
								})
							]
						}, f.key);
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							gridColumn: "1 / -1",
							display: "flex",
							alignItems: "center",
							gap: "10px",
							marginTop: "4px"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: saving || draft === null,
								onClick: () => {
									save();
								},
								style: {
									padding: "6px 16px",
									borderRadius: "6px",
									font: "inherit",
									border: "1px solid var(--dsw-alias-brand-primary)",
									background: "var(--dsw-alias-brand-primary)",
									color: "var(--dsw-alias-label-primary-foreground)",
									cursor: draft === null ? "default" : "pointer",
									opacity: draft === null ? .6 : 1
								},
								children: saving ? "保存中…" : "保存"
							}),
							draft !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: saving,
								onClick: () => {
									setDraft(null);
									setMessage(null);
									setFailed(false);
								},
								style: {
									padding: "6px 16px",
									border: "1px solid var(--dsw-alias-border-l2)",
									borderRadius: "6px",
									background: "transparent",
									font: "inherit",
									color: "var(--dsw-alias-label-secondary)",
									cursor: "pointer"
								},
								children: "放弃更改"
							}),
							message !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: "12px",
									color: failed ? "var(--dsw-alias-label-error)" : "var(--dsw-alias-label-secondary)"
								},
								children: message
							})
						]
					})]
				})]
			});
		}
		const cardStyle = {
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: "10px",
			padding: "14px 16px",
			background: "var(--dsw-alias-bg-layer-3)",
			font: "13px/1.5 system-ui, \"Segoe UI\", \"Microsoft YaHei\", sans-serif",
			color: "var(--dsw-alias-label-primary)"
		};
		const btnStyle = {
			padding: "6px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: "6px",
			background: "transparent",
			color: "inherit",
			font: "inherit",
			cursor: "pointer",
			whiteSpace: "nowrap"
		};
		//#endregion
		//#region index.tsx
		/**
		* 浏览器半边（DSH 0.2.0 形态）：
		* 1) 设置 → 插件 →「邮件」标签页（settings.plugins.tab 槽）：邮箱连接与提醒规则表单，
		*    读写经 remote.settings——写入落 profile patch 的 email-tools entry config，
		*    宿主自动按新配置重挂载插件，保存即生效
		* 2) 重要新邮件提醒：宿主 SSE（/dsh-email/notify）→ 桌面通知 + 页内横幅
		*/
		const name = "dsh-email";
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.settings"
		];
		/** 词典命名空间（标签页 locale 字段所需，极小词条） */
		const NS = "dsh-email";
		const zh = { tab: "邮件" };
		const en = { tab: "Mail" };
		let banners = [];
		let permission = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
		const listeners = /* @__PURE__ */ new Set();
		function emit() {
			for (const cb of listeners) cb();
		}
		const store = {
			subscribe(cb) {
				listeners.add(cb);
				return () => {
					listeners.delete(cb);
				};
			},
			getBanners() {
				return banners;
			},
			getPermission() {
				return permission;
			}
		};
		let bannerSeq = 0;
		function pushBanner(mail) {
			bannerSeq += 1;
			const banner = {
				...mail,
				key: bannerSeq
			};
			banners = [...banners, banner].slice(-4);
			emit();
			setTimeout(() => {
				banners = banners.filter((b) => b.key !== banner.key);
				emit();
			}, 8e3);
		}
		function showNotification(mail) {
			if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
			try {
				const n = new Notification(`新邮件：${mail.subject}`, {
					body: `${mail.from}\n${mail.snippet}`,
					tag: mail.tag
				});
				n.onclick = () => {
					window.focus();
					n.close();
				};
			} catch {}
		}
		function onImportantMails(mails) {
			for (const mail of mails) {
				showNotification(mail);
				pushBanner(mail);
			}
		}
		/** SSE 地址相对 document.baseURI 解析（反向代理子路径部署安全） */
		function notifyUrl() {
			return new URL("dsh-email/notify", document.baseURI).toString();
		}
		function connectSse() {
			if (typeof document === "undefined") return () => {};
			const es = new EventSource(notifyUrl());
			es.addEventListener("important-mail", (ev) => {
				try {
					onImportantMails(JSON.parse(ev.data));
				} catch {}
			});
			return () => es.close();
		}
		async function requestNotifyPermission() {
			if (typeof Notification === "undefined") return;
			permission = await Notification.requestPermission();
			emit();
		}
		function apply(ctx) {
			ctx.effect(() => {
				try {
					ctx.locale.register(NS, {
						zh,
						en
					});
				} catch {}
				const t = (key) => zh[key] ?? String(key);
				const face = {
					describe: async () => {
						const response = await ctx.remote.settings.describe();
						return response.ok && response.value !== void 0 ? { namespaces: response.value.namespaces } : { error: response.error?.message ?? "settings.describe failed" };
					},
					mutate: async (ns, ops, revision) => {
						const response = await ctx.remote.settings.mutate(ns, ops, revision);
						return response.ok ? { ok: true } : {
							ok: false,
							error: response.error?.message ?? "settings.mutate failed"
						};
					}
				};
				const offTab = ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
					name: "settings.plugins.tab",
					id: "dsh-email",
					order: 30,
					label: () => t("tab"),
					locale: NS,
					inject: () => ({ face })
				}, MailSettingsTab));
				return () => {
					offTab();
				};
			}, "dsh-email: settings tab");
			ctx.effect(() => {
				const disconnect = connectSse();
				const offOverlay = ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "dsh-email-notify",
					label: () => "dsh-email"
				}, () => (0, react.createElement)(NotifyLayer)));
				return () => {
					disconnect();
					offOverlay();
				};
			}, "dsh-email: notify");
		}
		function NotifyLayer() {
			const list = (0, react.useSyncExternalStore)(store.subscribe, store.getBanners);
			const showGuide = (0, react.useSyncExternalStore)(store.subscribe, store.getPermission) === "default";
			if (list.length === 0 && !showGuide) return null;
			return (0, react.createElement)("div", { style: {
				position: "fixed",
				top: "14px",
				right: "14px",
				zIndex: 9999,
				display: "flex",
				flexDirection: "column",
				gap: "8px",
				maxWidth: "360px",
				pointerEvents: "none"
			} }, showGuide && (0, react.createElement)("div", { style: {
				pointerEvents: "auto",
				padding: "8px 12px",
				borderRadius: "8px",
				background: "rgba(29,29,31,0.86)",
				color: "#fff",
				display: "flex",
				alignItems: "center",
				gap: "8px",
				font: "13px/1.4 system-ui, \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
			} }, (0, react.createElement)("span", null, "邮件提醒"), (0, react.createElement)("button", {
				type: "button",
				onClick: () => {
					requestNotifyPermission();
				},
				style: {
					padding: "3px 10px",
					borderRadius: "6px",
					border: "none",
					background: "#2563eb",
					color: "#fff",
					font: "inherit",
					cursor: "pointer"
				}
			}, "开启桌面通知")), ...list.map((b) => (0, react.createElement)("div", {
				key: b.key,
				style: {
					pointerEvents: "auto",
					padding: "10px 14px",
					borderRadius: "10px",
					background: "rgba(29,29,31,0.92)",
					color: "#fff",
					boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
					font: "13px/1.45 system-ui, \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
				}
			}, (0, react.createElement)("div", { style: {
				fontWeight: 600,
				marginBottom: "2px"
			} }, `✉️ ${b.subject}`), (0, react.createElement)("div", { style: { opacity: .85 } }, b.from), b.snippet !== "" && (0, react.createElement)("div", { style: {
				opacity: .65,
				marginTop: "2px"
			} }, b.snippet))));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map