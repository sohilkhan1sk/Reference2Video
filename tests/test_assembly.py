import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from assembly import (
    assemble_clips,
    build_concat_command,
    build_normalize_command,
    output_size,
    video_filter,
    build_audio_mux_command,
    build_xfade_command,
    build_subtitle_burn_command,
    normalize_scene_edits,
    scene_edit_summary,
)


class AssemblyTests(unittest.TestCase):
    def test_export_dimensions_and_padding_filter(self):
        self.assertEqual(output_size("16:9"), (1280, 720))
        self.assertEqual(output_size("9:16"), (720, 1280))
        self.assertIn("force_original_aspect_ratio=decrease", video_filter("9:16"))
        self.assertIn("pad=720:1280", video_filter("9:16"))
        with self.assertRaises(ValueError):
            output_size("1:1")

    def test_normalization_drops_audio_and_encodes_h264(self):
        command = build_normalize_command("ffmpeg", "in.mp4", "out.mp4", "16:9")
        self.assertIn("-an", command)
        self.assertIn("libx264", command)
        self.assertIn("1280:720", command[command.index("-vf") + 1])

    def test_concat_command_uses_concat_demuxer_and_stream_copy(self):
        command = build_concat_command("ffmpeg", "list.txt", "final.mp4")
        self.assertEqual(command[command.index("-f") + 1], "concat")
        self.assertIn("copy", command)
        self.assertIn("-an", command)

    def test_assemble_clips_normalizes_and_concatenates_in_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_a = root / "a.mp4"
            source_b = root / "b.mp4"
            source_a.write_bytes(b"source-a")
            source_b.write_bytes(b"source-b")
            output = root / "exports" / "final.mp4"
            calls = []

            def fake_runner(command, **kwargs):
                calls.append(command)
                Path(command[-1]).parent.mkdir(parents=True, exist_ok=True)
                Path(command[-1]).write_bytes(b"fake-mp4")
                return SimpleNamespace(returncode=0, stderr="", stdout="")

            result = assemble_clips(
                [source_a, source_b], output, "9:16", "ffmpeg",
                root / "work", runner=fake_runner,
            )
            self.assertEqual(result, output)
            self.assertEqual(len(calls), 3)
            self.assertIn("720:1280", calls[0][calls[0].index("-vf") + 1])
            self.assertIn("-an", calls[0])
            concat_list = root / "work" / "concat-list.txt"
            entries = concat_list.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(entries), 2)
            self.assertIn("normalized-001.mp4", entries[0])
            self.assertIn("normalized-002.mp4", entries[1])
            self.assertTrue(output.is_file())

    def test_audio_mux_mixes_voiceover_and_loops_music_with_ducking(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            voice = root / "voice.mp3"
            music = root / "music.mp3"
            voice.write_bytes(b"voice")
            music.write_bytes(b"music")
            command = build_audio_mux_command(
                "ffmpeg", "joined.mp4", "final.mp4", voice, music,
                voiceover_gain=1.2, music_gain=0.2,
            )
            self.assertIn("-stream_loop", command)
            self.assertIn("sidechaincompress", command[command.index("-filter_complex") + 1])
            self.assertIn("amix=inputs=2", command[command.index("-filter_complex") + 1])
            self.assertIn("-shortest", command)
            self.assertIn("aac", command)

    def test_audio_mux_supports_voiceover_only_and_rejects_invalid_gain(self):
        with tempfile.TemporaryDirectory() as tmp:
            voice = Path(tmp) / "voice.wav"
            voice.write_bytes(b"voice")
            command = build_audio_mux_command(
                "ffmpeg", "joined.mp4", "final.mp4", voiceover_path=voice
            )
            graph = command[command.index("-filter_complex") + 1]
            self.assertIn("apad", graph)
            self.assertNotIn("sidechaincompress", graph)
            with self.assertRaises(ValueError):
                build_audio_mux_command(
                    "ffmpeg", "joined.mp4", "final.mp4", voiceover_path=voice,
                    voiceover_gain=2.1,
                )

    def test_assemble_clips_runs_audio_mux_after_video_concat(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "scene.mp4"
            voice = root / "voice.wav"
            music = root / "music.mp3"
            source.write_bytes(b"scene")
            voice.write_bytes(b"voice")
            music.write_bytes(b"music")
            output = root / "exports" / "final.mp4"
            calls = []

            def fake_runner(command, **kwargs):
                calls.append(command)
                Path(command[-1]).parent.mkdir(parents=True, exist_ok=True)
                Path(command[-1]).write_bytes(b"fake-output")
                return SimpleNamespace(returncode=0, stderr="", stdout="")

            assemble_clips(
                [source], output, "16:9", "ffmpeg", root / "work",
                runner=fake_runner, voiceover_path=voice, music_path=music,
            )
            self.assertEqual(len(calls), 3)
            self.assertIn("-filter_complex", calls[-1])
            self.assertEqual(calls[-1][-1], str(output))
            self.assertTrue(output.is_file())

    def test_timed_sound_effects_are_delayed_and_mixed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "impact.wav"
            second = root / "whoosh.mp3"
            first.write_bytes(b"impact")
            second.write_bytes(b"whoosh")
            command = build_audio_mux_command(
                "ffmpeg", "joined.mp4", "final.mp4",
                sound_effects=[
                    {"path": first, "start_seconds": 2.5, "gain": 0.8},
                    {"path": second, "start_seconds": 7.25, "gain": 1.2},
                ],
            )
            graph = command[command.index("-filter_complex") + 1]
            self.assertIn("adelay=2500:all=1", graph)
            self.assertIn("adelay=7250:all=1", graph)
            self.assertIn("amix=inputs=2", graph)
            self.assertEqual(command.count("-i"), 3)
            self.assertIn("-shortest", command)
            self.assertIn("aac", command)

    def test_timed_sound_effects_mix_with_voiceover_and_ducked_music(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            voice = root / "voice.wav"
            music = root / "music.mp3"
            sfx = root / "click.wav"
            for path in (voice, music, sfx):
                path.write_bytes(b"audio")
            command = build_audio_mux_command(
                "ffmpeg", "joined.mp4", "final.mp4", voice, music,
                sound_effects=[{"path": sfx, "start_seconds": 4, "gain": 1}],
            )
            graph = command[command.index("-filter_complex") + 1]
            self.assertIn("sidechaincompress", graph)
            self.assertIn("adelay=4000:all=1", graph)
            self.assertIn("amix=inputs=3", graph)

    def test_timed_sound_effect_validation_rejects_bad_timestamps_and_missing_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sfx = root / "click.wav"
            sfx.write_bytes(b"audio")
            with self.assertRaises(ValueError):
                build_audio_mux_command(
                    "ffmpeg", "joined.mp4", "final.mp4",
                    sound_effects=[{"path": sfx, "start_seconds": 901, "gain": 1}],
                )
            with self.assertRaises(ValueError):
                build_audio_mux_command(
                    "ffmpeg", "joined.mp4", "final.mp4",
                    sound_effects=[{"path": sfx, "start_seconds": 1, "gain": 2.1}],
                )
            with self.assertRaises(FileNotFoundError):
                build_audio_mux_command(
                    "ffmpeg", "joined.mp4", "final.mp4",
                    sound_effects=[{"path": root / "missing.wav", "start_seconds": 1, "gain": 1}],
                )

    def test_assemble_clips_includes_timed_sfx_in_final_mux(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "scene.mp4"
            sfx = root / "impact.wav"
            source.write_bytes(b"scene")
            sfx.write_bytes(b"impact")
            output = root / "exports" / "final.mp4"
            calls = []

            def fake_runner(command, **kwargs):
                calls.append(command)
                Path(command[-1]).parent.mkdir(parents=True, exist_ok=True)
                Path(command[-1]).write_bytes(b"fake-output")
                return SimpleNamespace(returncode=0, stderr="", stdout="")

            assemble_clips(
                [source], output, "16:9", "ffmpeg", root / "work",
                runner=fake_runner,
                sound_effects=[{"path": sfx, "start_seconds": 3.25, "gain": 0.9}],
            )
            self.assertEqual(len(calls), 3)
            graph = calls[-1][calls[-1].index("-filter_complex") + 1]
            self.assertIn("adelay=3250:all=1", graph)
            self.assertTrue(output.is_file())


    def test_audio_mux_applies_trim_and_fades_to_all_tracks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            voice = root / "voice.wav"
            music = root / "music.mp3"
            sfx = root / "impact.wav"
            for path in (voice, music, sfx):
                path.write_bytes(b"audio")
            command = build_audio_mux_command(
                "ffmpeg", "joined.mp4", "final.mp4",
                voiceover_path=voice, music_path=music,
                voiceover_trim_start_seconds=1.25,
                voiceover_trim_end_seconds=12,
                voiceover_fade_in_seconds=0.4,
                voiceover_fade_out_start_seconds=9,
                voiceover_fade_out_seconds=1,
                music_trim_start_seconds=3,
                music_trim_end_seconds=30,
                music_fade_in_seconds=2,
                music_fade_out_start_seconds=24,
                music_fade_out_seconds=3,
                sound_effects=[{
                    "path": sfx, "start_seconds": 5, "gain": 0.8,
                    "trim_start_seconds": 0.5, "trim_end_seconds": 2.5,
                    "fade_in_seconds": 0.2, "fade_out_start_seconds": 1.5,
                    "fade_out_seconds": 0.3,
                }],
            )
            graph = command[command.index("-filter_complex") + 1]
            self.assertIn("atrim=start=1.25:end=12", graph)
            self.assertIn("afade=t=in:st=0:d=0.4", graph)
            self.assertIn("afade=t=out:st=9:d=1", graph)
            self.assertIn("atrim=start=3:end=30", graph)
            self.assertIn("afade=t=in:st=0:d=2", graph)
            self.assertIn("afade=t=out:st=24:d=3", graph)
            self.assertIn("atrim=start=0.5:end=2.5", graph)
            self.assertIn("afade=t=out:st=1.5:d=0.3", graph)
            self.assertIn("adelay=5000:all=1", graph)

    def test_audio_gain_rejects_nan(self):
        with tempfile.TemporaryDirectory() as tmp:
            voice = Path(tmp) / "voice.wav"
            voice.write_bytes(b"voice")
            with self.assertRaises(ValueError):
                build_audio_mux_command(
                    "ffmpeg", "joined.mp4", "final.mp4",
                    voiceover_path=voice, voiceover_gain=float("nan"),
                )

    def test_audio_processing_rejects_invalid_trim_and_fade_ranges(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            voice = root / "voice.wav"
            voice.write_bytes(b"voice")
            with self.assertRaises(ValueError):
                build_audio_mux_command(
                    "ffmpeg", "joined.mp4", "final.mp4",
                    voiceover_path=voice,
                    voiceover_trim_start_seconds=5,
                    voiceover_trim_end_seconds=5,
                )
            with self.assertRaises(ValueError):
                build_audio_mux_command(
                    "ffmpeg", "joined.mp4", "final.mp4",
                    voiceover_path=voice,
                    voiceover_trim_start_seconds=1,
                    voiceover_trim_end_seconds=3,
                    voiceover_fade_in_seconds=1.5,
                    voiceover_fade_out_seconds=1,
                )
            with self.assertRaises(ValueError):
                build_audio_mux_command(
                    "ffmpeg", "joined.mp4", "final.mp4",
                    voiceover_path=voice,
                    voiceover_fade_out_start_seconds=3601,
                )


    def test_scene_edits_default_to_full_source_and_hard_cuts(self):
        edits = normalize_scene_edits(None, [5.4, 8])
        self.assertEqual([item["trim_start_seconds"] for item in edits], [0, 0])
        self.assertEqual([item["trim_end_seconds"] for item in edits], [5.4, 8])
        self.assertEqual([item["transition_after"] for item in edits], ["cut", "cut"])
        self.assertEqual(scene_edit_summary(edits), {
            "crossfade_count": 0, "final_duration_seconds": 13.4
        })

    def test_scene_edits_apply_trims_and_crossfade_duration(self):
        edits = normalize_scene_edits([
            {"trim_start_seconds": 1, "trim_end_seconds": 4.5,
             "transition_after": "crossfade", "transition_duration_seconds": 0.5},
            {"trim_start_seconds": 0.5, "trim_end_seconds": 5},
        ], [5, 6])
        self.assertEqual(edits[0]["duration_seconds"], 3.5)
        self.assertEqual(edits[1]["duration_seconds"], 4.5)
        self.assertEqual(scene_edit_summary(edits), {
            "crossfade_count": 1, "final_duration_seconds": 7.5
        })

    def test_scene_edits_reject_invalid_bounds_and_last_scene_transition(self):
        with self.assertRaisesRegex(ValueError, "exceeds"):
            normalize_scene_edits([{"trim_end_seconds": 6}], [5])
        with self.assertRaisesRegex(ValueError, "final scene"):
            normalize_scene_edits([{"transition_after": "crossfade"}], [5])
        with self.assertRaisesRegex(ValueError, "greater than"):
            normalize_scene_edits([{"trim_start_seconds": 3, "trim_end_seconds": 3}], [5])

    def test_scene_edits_require_enough_frames_for_adjacent_crossfades(self):
        with self.assertRaisesRegex(ValueError, "too short"):
            normalize_scene_edits([
                {"transition_after": "crossfade", "transition_duration_seconds": 1.5},
                {"transition_after": "crossfade", "transition_duration_seconds": 1.5},
                {},
            ], [2.5, 2.5, 5])

    def test_normalize_command_trims_before_scaling(self):
        command = build_normalize_command(
            "ffmpeg", "source.mp4", "trimmed.mp4", "16:9",
            scene_edit={"trim_start_seconds": 1.25, "trim_end_seconds": 4.75},
        )
        video_graph = command[command.index("-vf") + 1]
        self.assertIn("trim=start=1.250:end=4.750", video_graph)
        self.assertLess(video_graph.index("trim="), video_graph.index("scale="))
        self.assertIn("setpts=PTS-STARTPTS", video_graph)

    def test_xfade_command_calculates_cumulative_offsets(self):
        command = build_xfade_command(
            "ffmpeg", ["group-a.mp4", "group-b.mp4", "group-c.mp4"],
            [4, 5, 6], [0.5, 0.75], "final.mp4",
        )
        graph = command[command.index("-filter_complex") + 1]
        self.assertIn("duration=0.500:offset=3.500", graph)
        self.assertIn("duration=0.750:offset=7.750", graph)
        self.assertEqual(command.count("-i"), 3)
        self.assertIn("libx264", command)
        self.assertEqual(command[-1], "final.mp4")

    def test_assembly_groups_hard_cuts_and_applies_crossfade(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sources = [root / f"scene-{index}.mp4" for index in range(3)]
            for path in sources:
                path.write_bytes(b"source")
            edits = normalize_scene_edits([
                {"transition_after": "crossfade", "transition_duration_seconds": 0.5},
                {},
                {},
            ], [4, 5, 6])
            output = root / "exports" / "final.mp4"
            calls = []

            def fake_runner(command, **kwargs):
                calls.append(command)
                Path(command[-1]).parent.mkdir(parents=True, exist_ok=True)
                Path(command[-1]).write_bytes(b"fake-mp4")
                return SimpleNamespace(returncode=0, stderr="", stdout="")

            assemble_clips(
                sources, output, "16:9", "ffmpeg", root / "work",
                runner=fake_runner, scene_edits=edits,
            )
            self.assertEqual(len(calls), 5)
            xfade_graph = calls[-1][calls[-1].index("-filter_complex") + 1]
            self.assertIn("xfade=transition=fade:duration=0.500:offset=3.500", xfade_graph)
            self.assertTrue(output.is_file())

    def test_empty_or_missing_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaises(ValueError):
                assemble_clips([], root / "out.mp4", "16:9", "ffmpeg", root / "work")
            missing = root / "missing.mp4"
            with self.assertRaises(FileNotFoundError):
                assemble_clips([missing], root / "out.mp4", "16:9", "ffmpeg", root / "work")


    def test_subtitle_burn_command_uses_safe_style_and_libass_filter(self):
        with tempfile.TemporaryDirectory() as tmp:
            subtitle_file = Path(tmp) / "captions.srt"
            subtitle_file.write_text(
                "1\n00:00:00,000 --> 00:00:01,000\nHello\n",
                encoding="utf-8",
            )
            command = build_subtitle_burn_command(
                "ffmpeg", "joined.mp4", "captioned.mp4", subtitle_file,
                "9:16",
                {"position": "top", "color": "yellow", "font_size_ratio": 0.05},
            )
            graph = command[command.index("-vf") + 1]
            self.assertIn("subtitles=filename=", graph)
            self.assertIn("force_style=", graph)
            self.assertIn("FontSize=64", graph)
            self.assertIn("Alignment=8", graph)
            self.assertIn("PrimaryColour=&H0000FFFF", graph)
            self.assertIn("libx264", command)
            self.assertIn("-an", command)

    def test_assemble_clips_burns_subtitles_for_silent_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "scene.mp4"
            subtitles = root / "captions.srt"
            source.write_bytes(b"scene")
            subtitles.write_text(
                "1\n00:00:00,000 --> 00:00:01,000\nHello\n",
                encoding="utf-8",
            )
            output = root / "exports" / "final.mp4"
            calls = []

            def fake_runner(command, **kwargs):
                calls.append(command)
                Path(command[-1]).parent.mkdir(parents=True, exist_ok=True)
                Path(command[-1]).write_bytes(b"fake-output")
                return SimpleNamespace(returncode=0, stderr="", stdout="")

            assemble_clips(
                [source], output, "16:9", "ffmpeg", root / "work",
                runner=fake_runner, subtitle_path=subtitles,
                subtitle_style={"position": "bottom", "color": "white"},
            )
            self.assertEqual(len(calls), 3)
            self.assertIn("subtitles=filename=", calls[-1][calls[-1].index("-vf") + 1])
            self.assertEqual(calls[-1][-1], str(output))
            self.assertTrue(output.is_file())

    def test_assemble_burns_subtitles_before_audio_mux(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "scene.mp4"
            subtitles = root / "captions.srt"
            voice = root / "voice.wav"
            source.write_bytes(b"scene")
            subtitles.write_text(
                "1\n00:00:00,000 --> 00:00:01,000\nHello\n",
                encoding="utf-8",
            )
            voice.write_bytes(b"voice")
            output = root / "exports" / "final.mp4"
            calls = []

            def fake_runner(command, **kwargs):
                calls.append(command)
                Path(command[-1]).parent.mkdir(parents=True, exist_ok=True)
                Path(command[-1]).write_bytes(b"fake-output")
                return SimpleNamespace(returncode=0, stderr="", stdout="")

            assemble_clips(
                [source], output, "16:9", "ffmpeg", root / "work",
                runner=fake_runner, voiceover_path=voice,
                subtitle_path=subtitles,
            )
            self.assertEqual(len(calls), 4)
            subtitle_command = calls[-2]
            audio_command = calls[-1]
            self.assertIn("subtitles=filename=", subtitle_command[subtitle_command.index("-vf") + 1])
            self.assertIn("captioned-silent.mp4", audio_command)
            self.assertEqual(audio_command[-1], str(output))


if __name__ == "__main__":
    unittest.main()
