window.__ModuleLoader__.load({ id: "@puwenhui/dsh-email", factory: (require) => {


		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region settings-card.tsx
		/**
		* 设置 → 插件 →「邮件」配置卡：邮箱连接与重要邮件提醒规则。
		* 交互与外观对齐宿主 PluginCard 模式：点击头部展开/收起、保存成功自动收起、
		* 未保存标记；颜色全部走宿主主题变量（--dsw-alias-*，跟随「通用设置」外观）。
		* 读写经宿主 settingsScope（revision fence）；「已覆盖」标记与恢复默认基于
		* user 层字段存在性；密码字段不回显，输入新值才写入。
		*/
		/** 字段清单（与宿主半边 MailSettings schema 保持同步） */
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
				placeholder: "INBOX, 已发送"
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
		function SettingsCard({ scope }) {
			const subscribe = useSync(scope, (s) => s.subscribe.bind(s));
			const getSnapshot = useSync(scope, (s) => s.getSnapshot.bind(s));
			const snap = (0, react.useSyncExternalStore)(subscribe, getSnapshot);
			const [open, setOpen] = (0, react.useState)(false);
			const [draft, setDraft] = (0, react.useState)(null);
			const [saving, setSaving] = (0, react.useState)(false);
			const [message, setMessage] = (0, react.useState)(null);
			const [failed, setFailed] = (0, react.useState)(false);
			const saveStarted = (0, react.useRef)(false);
			const current = snap.value ?? {};
			const userLayer = snap.user ?? {};
			const shown = draft ?? current;
			const dirty = draft !== null;
			(0, react.useEffect)(() => {
				if (saving) {
					saveStarted.current = true;
					return;
				}
				if (!saveStarted.current) return;
				saveStarted.current = false;
				if (!dirty && !failed) setOpen(false);
			}, [
				dirty,
				failed,
				saving
			]);
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
				if (draft === null) return;
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
					if (ops.length > 0) await scope.mutate(ops, snap.revision);
					setDraft(null);
					setFailed(false);
					setMessage(ops.length > 0 ? "已保存，即时生效" : "无更改");
				} catch (e) {
					setFailed(true);
					setMessage(`保存失败：${String(e.message)}`);
				} finally {
					setSaving(false);
				}
			};
			const resetField = async (f) => {
				setSaving(true);
				try {
					await scope.mutate([{
						op: "unset",
						path: [f.key]
					}], snap.revision);
					if (draft !== null) {
						const next = { ...draft };
						delete next[f.key];
						setDraft(next);
					}
					setMessage(`已恢复默认：${f.label}`);
				} catch (e) {
					setFailed(true);
					setMessage(`恢复失败：${String(e.message)}`);
				} finally {
					setSaving(false);
				}
			};
			if (snap.status !== "ready") {
				if (snap.status === "unavailable") return null;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						...cardStyle,
						padding: "12px 16px",
						color: "var(--dsw-alias-label-tertiary)"
					},
					children: "邮件配置加载中…"
				});
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: cardStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					"aria-expanded": open,
					onClick: () => {
						setOpen(!open);
					},
					style: {
						display: "flex",
						alignItems: "center",
						gap: "10px",
						width: "100%",
						background: "transparent",
						border: "none",
						padding: "2px 0",
						color: "inherit",
						font: "inherit",
						cursor: "pointer",
						textAlign: "left"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "2px",
								flex: "1 1 auto"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontWeight: 600,
									fontSize: "14px",
									color: "var(--dsw-alias-label-primary)"
								},
								children: "邮件"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: "12px",
									color: "var(--dsw-alias-label-tertiary)"
								},
								children: "邮箱连接（IMAP/SMTP）与重要新邮件提醒"
							})]
						}),
						dirty && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: "11px",
								color: "var(--dsw-alias-label-secondary)",
								border: "1px solid var(--dsw-alias-border-l2)",
								borderRadius: "4px",
								padding: "1px 6px"
							},
							children: "未保存"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, { style: {
							transform: open ? "rotate(180deg)" : "none",
							transition: "transform 0.15s",
							flex: "0 0 auto"
						} })
					]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: "10px 14px",
						marginTop: "12px",
						paddingTop: "12px",
						borderTop: "1px solid var(--dsw-alias-border-l2)"
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
										f.type === "secret" ? overridden && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												marginLeft: "6px",
												color: "var(--dsw-alias-brand-primary)"
											},
											children: "·已设置"
										}) : overridden && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												marginLeft: "6px",
												color: "var(--dsw-alias-brand-primary)"
											},
											title: "用户已覆盖默认值",
											children: "·已覆盖"
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
									style: {
										width: "100%",
										padding: "6px 10px",
										font: "inherit",
										boxSizing: "border-box",
										border: "1px solid var(--dsw-alias-border-l2)",
										borderRadius: "6px",
										background: "var(--dsw-alias-bg-layer-2)",
										color: "var(--dsw-alias-label-primary)"
									}
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
								disabled: saving || !dirty,
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
									cursor: dirty ? "pointer" : "default",
									opacity: dirty ? 1 : .6
								},
								children: saving ? "保存中…" : "保存"
							}),
							dirty && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
		/** 从 scope 派生稳定回调（绑定 this） */
		function useSync(scope, pick) {
			const [fn] = (0, react.useState)(() => pick(scope));
			return fn;
		}
		const cardStyle = {
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: "10px",
			padding: "12px 16px",
			background: "var(--dsw-alias-bg-layer-3)",
			font: "13px/1.5 system-ui, \"Segoe UI\", \"Microsoft YaHei\", sans-serif",
			color: "var(--dsw-alias-label-primary)"
		};
		//#endregion
		//#region index.tsx
		/**
		* 浏览器半边：
		* 1) 设置 → 插件 →「邮件」配置卡（settings.plugin.item keyed 槽，读写经 settingsScope）
		* 2) 重要新邮件提醒：宿主 SSE（/dsh-email/notify）→ 桌面通知 + 页内右上横幅兜底
		*/
		const name = "dsh-email";
		const inject = [
			"slots",
			"locale",
			"theme"
		];
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
			ctx.inject(["settingsScope"], (scopedCtx) => {
				const scoped = scopedCtx;
				const scope = scoped.settingsScope.bind({ namespace: "dsh-email" });
				scoped.effect(() => scoped.slots.inject("settings.plugin.item", () => scoped.slots.register({
					name: "settings.plugin.item",
					key: "dsh-email"
				}, () => (0, react.createElement)(SettingsCard, { scope }))), "dsh-email: settings card");
			});
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