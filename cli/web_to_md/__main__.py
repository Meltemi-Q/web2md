import click
from rich.console import Console
from rich.markdown import Markdown
from rich.table import Table
from rich.progress import Progress
from .extractor import WebExtractor

console = Console()


@click.group()
def cli():
    """Web to Markdown - 网页内容提取工具"""
    pass


@cli.command()
@click.argument("url")
@click.option("-o", "--output", help="输出文件路径")
@click.option("--format", type=click.Choice(["markdown", "html", "txt"]), default="markdown", help="输出格式")
@click.option("--no-comments", is_flag=True, help="不包含评论")
@click.option("--no-images", is_flag=True, help="不保留图片链接")
@click.option("--download-images", is_flag=True, help="下载图片到本地")
@click.option("--images-dir", help="图片保存目录")
def extract(url: str, output: str, format: str, no_comments: bool, no_images: bool, download_images: bool, images_dir: str):
    """提取单个网页内容并转换为 Markdown"""
    extractor = WebExtractor()

    # 如果要下载图片但没有指定目录，自动创建一个
    import os
    import tempfile
    if download_images and not images_dir:
        # 使用输出文件所在目录，或者临时目录
        if output:
            output_dir = os.path.dirname(output)
            if not output_dir:
                output_dir = "."
        else:
            output_dir = "."
        # 生成一个基于 URL 的目录名
        import hashlib
        url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
        images_dir = os.path.join(output_dir, f"images_{url_hash}")
        os.makedirs(images_dir, exist_ok=True)
        console.print(f"[yellow]图片将保存到: {images_dir}[/yellow]")

    with console.status("[bold green]正在抓取内容...", spinner="dots"):
        result = extractor.extract(
            url,
            output_format=format,
            include_comments=not no_comments,
            include_images=not no_images,
            download_images=download_images,
            images_dir=images_dir
        )

    if result.get("error"):
        console.print(f"[red]错误: {result['error']}[/red]")
        return

    # 显示结果
    console.print(f"\n[bold cyan]标题:[/bold cyan] {result['title']}")
    if result.get('author'):
        console.print(f"[bold]作者:[/bold] {result['author']}")
    if result.get('date'):
        console.print(f"[bold]日期:[/bold] {result['date']}")
    console.print(f"[bold]来源:[/bold] {result['url']}")
    if result.get('images'):
        console.print(f"[bold]图片:[/bold] 已下载 {len(result['images'])} 张")

    console.print(f"\n[bold green]内容预览:[/bold green]\n")
    preview = result['content'][:500] + "..." if len(result['content']) > 500 else result['content']
    console.print(Markdown(preview))

    # 保存到文件
    if output:
        with open(output, "w", encoding="utf-8") as f:
            f.write(f"# {result['title']}\n\n")
            if result.get('author'):
                f.write(f"**作者**: {result['author']}\n\n")
            if result.get('date'):
                f.write(f"**日期**: {result['date']}\n\n")
            f.write(f"**来源**: {result['url']}\n\n")
            f.write("---\n\n")
            f.write(result['content'])
        console.print(f"\n[green]✓ 已保存到: {output}[/green]")


@cli.command()
@click.argument("urls_file", type=click.Path(exists=True))
@click.option("-o", "--output-dir", default="./output", help="输出目录")
@click.option("--format", type=click.Choice(["markdown", "html", "txt"]), default="markdown", help="输出格式")
@click.option("--download-images", is_flag=True, help="下载图片到本地")
@click.option("--max-workers", default=5, help="并发数")
def batch(urls_file: str, output_dir: str, format: str, download_images: bool, max_workers: int):
    """批量提取多个网页（从文件读取 URL 列表）"""
    # 读取 URL 列表
    with open(urls_file, 'r', encoding='utf-8') as f:
        urls = [line.strip() for line in f if line.strip() and not line.startswith('#')]

    if not urls:
        console.print("[red]错误: 文件中没有有效的 URL[/red]")
        return

    console.print(f"[bold]准备处理 {len(urls)} 个 URL[/bold]\n")

    extractor = WebExtractor(max_workers=max_workers)

    with Progress() as progress:
        task = progress.add_task("[green]抓取中...", total=len(urls))

        results = extractor.extract_batch(
            urls,
            output_dir=output_dir,
            output_format=format,
            download_images=download_images
        )

        progress.update(task, completed=len(urls))

    # 显示结果表格
    table = Table(title="\n抓取结果")
    table.add_column("URL", style="cyan")
    table.add_column("状态", style="bold")
    table.add_column("文件", style="green")

    success_count = 0
    for result in results:
        if result.get("error"):
            table.add_row(result['url'][:40] + "...", "[red]失败[/red]", result['error'][:30])
        else:
            table.add_row(result['url'][:40] + "...", "[green]成功[/green]", result.get('saved_to', 'N/A'))
            success_count += 1

    console.print(table)
    console.print(f"\n[bold]成功: {success_count}/{len(urls)}[/bold]")


@cli.command()
@click.argument("urls", nargs=-1, required=True)
@click.option("-o", "--output-dir", default="./output", help="输出目录")
@click.option("--format", type=click.Choice(["markdown", "html", "txt"]), default="markdown", help="输出格式")
@click.option("--download-images", is_flag=True, help="下载图片到本地")
@click.option("--max-workers", default=5, help="并发数")
def multi(urls: tuple, output_dir: str, format: str, download_images: bool, max_workers: int):
    """批量提取多个网页（直接传入 URL）"""
    console.print(f"[bold]准备处理 {len(urls)} 个 URL[/bold]\n")

    extractor = WebExtractor(max_workers=max_workers)

    with Progress() as progress:
        task = progress.add_task("[green]抓取中...", total=len(urls))
        results = extractor.extract_batch(
            list(urls),
            output_dir=output_dir,
            output_format=format,
            download_images=download_images
        )
        progress.update(task, completed=len(urls))

    # 显示结果
    table = Table(title="\n抓取结果")
    table.add_column("URL", style="cyan")
    table.add_column("状态", style="bold")
    table.add_column("文件", style="green")

    success_count = 0
    for result in results:
        if result.get("error"):
            table.add_row(result['url'][:40] + "...", "[red]失败[/red]", result['error'][:30])
        else:
            table.add_row(result['url'][:40] + "...", "[green]成功[/green]", result.get('saved_to', 'N/A'))
            success_count += 1

    console.print(table)
    console.print(f"\n[bold]成功: {success_count}/{len(urls)}[/bold]")


def main():
    cli()


if __name__ == "__main__":
    main()
